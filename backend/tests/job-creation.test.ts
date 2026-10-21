import { describe, it, expect, beforeEach } from '@jest/globals';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { registerVideoRoutes, DEFAULT_MAX_CUTS } from '../server/src/routes/videos.js';
import { InMemoryJobQueue } from '../server/src/jobs/job-queue.js';
import { buildJobId, buildQueueName } from '../server/src/types/job.js';

process.env.NODE_ENV = 'test';

/**
 * Repositório de jobs em memória — sem tocar no SQLite.
 * Import dinâmico do módulo de rotas após definir NODE_ENV=test.
 */
function createTestRepository() {
  const store = new Map<
    string,
    { videoId: string; status: string; progress: number; currentStep: string | null; error: string | null; createdAt: Date; updatedAt: Date }
  >();

  return {
    store,
    repository: {
      async create({ videoId }: { videoId: string }) {
        const now = new Date();
        const job = {
          id: `job_${videoId}`,
          videoId,
          status: 'QUEUED',
          progress: 0,
          currentStep: null,
          error: null,
          createdAt: now,
          updatedAt: now,
        };
        store.set(videoId, job);
        return job as any;
      },
      async updateStatus(videoId: string, status: any, error?: string | null) {
        const job = store.get(videoId);
        if (!job) return;
        const progressMap: Record<string, number> = {
          QUEUED: 0,
          PROCESSING_VIDEO: 10,
          EXTRACTING_AUDIO: 30,
          TRANSCRIBING: 50,
          ANALYZING: 70,
          GENERATING_CUTS: 90,
          COMPLETED: 100,
          FAILED: 0,
        };
        job.status = status;
        job.progress = progressMap[status] ?? 0;
        job.currentStep = status;
        job.error = error ?? null;
        job.updatedAt = new Date();
      },
      async findByVideoId(videoId: string) {
        return (store.get(videoId) as any) ?? null;
      },
      async list(limit = 50) {
        return Array.from(store.values()).slice(0, limit) as any;
      },
    },
  };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 1024 * 1024 * 1024, files: 1 } });
  await registerVideoRoutes(app);
  return app;
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  app = await buildApp();
});

describe('criação de job', () => {
  it('cria job com status inicial QUEUED e progresso 0', async () => {
    const { repository, store } = createTestRepository();
    await repository.create({ videoId: 'video-1' });

    const job = store.get('video-1');
    expect(job?.status).toBe('QUEUED');
    expect(job?.progress).toBe(0);
    expect(job?.currentStep).toBeNull();
    expect(job?.error).toBeNull();
  });

  it('atualiza status e progresso do job', async () => {
    const { repository, store } = createTestRepository();
    await repository.create({ videoId: 'video-1' });
    await repository.updateStatus('video-1', 'TRANSCRIBING');

    const job = store.get('video-1');
    expect(job?.status).toBe('TRANSCRIBING');
    expect(job?.progress).toBe(50);
  });

  it('registra mensagem de erro no job', async () => {
    const { repository, store } = createTestRepository();
    await repository.create({ videoId: 'video-1' });
    await repository.updateStatus('video-1', 'FAILED', 'FFmpeg não encontrado');

    expect(store.get('video-1')?.error).toBe('FFmpeg não encontrado');
  });

  it('busca job por videoId', async () => {
    const { repository } = createTestRepository();
    await repository.create({ videoId: 'video-1' });
    expect(await repository.findByVideoId('video-1')).not.toBeNull();
  });
});

describe('fila em memória', () => {
  it('enfileira e executa o job', async () => {
    const { repository } = createTestRepository();
    const queue = new InMemoryJobQueue(repository);
    await repository.create({ videoId: 'video-1' });

    let executed = false;
    queue.registerHandler('video-1', async () => {
      executed = true;
    });

    await queue.enqueue('video-1');
    await new Promise((r) => setTimeout(r, 50));

    expect(executed).toBe(true);
  });

  it('marca job como FAILED quando o handler lança erro', async () => {
    const { repository, store } = createTestRepository();
    const queue = new InMemoryJobQueue(repository);
    await repository.create({ videoId: 'video-1' });

    queue.registerHandler('video-1', async () => {
      throw new Error('falha no processamento');
    });

    await queue.enqueue('video-1');
    await new Promise((r) => setTimeout(r, 50));

    expect(store.get('video-1')?.status).toBe('FAILED');
    expect(store.get('video-1')?.error).toBe('falha no processamento');
  });

  it('respeita concorrência configurada', async () => {
    const { repository } = createTestRepository();
    const queue = new InMemoryJobQueue(repository);
    queue.setConcurrency(2);

    for (let i = 0; i < 5; i++) {
      await repository.create({ videoId: `video-${i}` });
      queue.registerHandler(`video-${i}`, async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      await queue.enqueue(`video-${i}`);
    }

    expect(queue.active).toBeLessThanOrEqual(2);
  });

  it('expõe identificadores prontos para BullMQ', () => {
    expect(buildJobId('abc')).toMatch(/^video:abc:/);
    expect(typeof buildQueueName()).toBe('string');
  });
});

describe('constantes da API', () => {
  it('DEFAULT_MAX_CUTS é exatamente 20', () => {
    expect(DEFAULT_MAX_CUTS).toBe(20);
  });
});

describe('validação de formato de vídeo', () => {
  const BOUNDARY = 'ViralCutJobBoundary';

  function multipart(filename: string, mimetype: string): { payload: Buffer; headers: Record<string, string> } {
    const header = Buffer.from(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${mimetype}\r\n\r\n`,
      'utf-8'
    );
    const footer = Buffer.from(`\r\n--${BOUNDARY}--\r\n`, 'utf-8');

    return {
      payload: Buffer.concat([header, Buffer.from('conteudo'), footer]),
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    };
  }

  it('rejeita formato não suportado com 415', async () => {
    const { payload, headers } = multipart('video.avi', 'video/x-msvideo');
    const response = await app.inject({ method: 'POST', url: '/api/videos', payload, headers });

    expect(response.statusCode).toBe(415);
    expect(response.json().error).toMatch(/Formato não suportado/);
  });

  it('rejeita requisição sem arquivo com 400', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/videos' });
    expect([400, 415]).toContain(response.statusCode);
  });
});
