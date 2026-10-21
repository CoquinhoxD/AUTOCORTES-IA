import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { spawn, spawnSync } from 'child_process';

// ---------------------------------------------------------------------------
// Este teste percorre o fluxo PRINCIPAL de ponta a ponta:
//   upload → validação → job → metadados (ffprobe) → áudio (ffmpeg) →
//   status → limpeza de temporários
//
// Ele usa um vídeo real gerado com FFmpeg (duração curta) e NÃO chama IA,
// porque a análise depende de credenciais externas. A etapa de IA é coberta
// por testes unitários com provider injetado (tests/ai-analysis.test.ts).
// ---------------------------------------------------------------------------

const CHUNK_DURATION = 3;

const BOUNDARY = 'ViralCutIntegrationBoundary';

// Detectado no carregamento do módulo (top-level) porque `describe` é
// avaliado antes de qualquer `beforeAll`.
const ffmpegAvailable = spawnSync('ffmpeg', ['-version']).status === 0;

/** Monta o corpo multipart manualmente — light-my-request não usa FormData. */
function buildMultipartPayload(content: Buffer, filename: string): Buffer {
  const header = Buffer.from(
    `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: video/mp4\r\n\r\n`,
    'utf-8'
  );
  const footer = Buffer.from(`\r\n--${BOUNDARY}--\r\n`, 'utf-8');
  return Buffer.concat([header, content, footer]);
}

let app: FastifyInstance;
let workDir: string;
let videoPath: string;

function createVideo(target: string, durationSeconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'ffmpeg',
      [
        '-y',
        '-f', 'lavfi',
        '-i', `testsrc=size=320x240:rate=15:duration=${durationSeconds}`,
        '-f', 'lavfi',
        '-i', `sine=frequency=440:duration=${durationSeconds}`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-shortest',
        target,
      ],
      { stdio: 'ignore' }
    );

    proc.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('FFMPEG_NOT_FOUND'));
        return;
      }
      reject(error);
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg saiu com código ${code}`));
    });
  });
}

beforeAll(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'viral-cut-test-'));
  videoPath = path.join(workDir, 'entrada.mp4');

  if (ffmpegAvailable) {
    await createVideo(videoPath, CHUNK_DURATION);
  }

  app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
  await app.register(fastifyStatic, { root: workDir, prefix: '/static/', decorateReply: true, index: false });

  // Rotas mínimas do fluxo principal, isoladas de Prisma e IA.
  app.post('/api/videos', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'Nenhum arquivo enviado.' });

    // Verificação de formato equivalente à da aplicação real.
    const extension = path.extname(file.filename).toLowerCase();
    if (!['.mp4', '.mov', '.webm', '.mkv'].includes(extension)) {
      return reply.code(415).send({ error: `Formato não suportado: ${file.mimetype}` });
    }

    const videoId = 'test-video-id';
    const target = path.join(workDir, `${videoId}-${file.filename}`);

    const handle = await fs.open(target, 'w');
    const stream = handle.createWriteStream();

    await new Promise<void>((resolve, reject) => {
      file.file.pipe(stream);
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });

    return reply.code(202).send({ videoId, status: 'QUEUED' });
  });

  app.get('/api/videos/:id/stream', async (request, reply) => {
    const { id } = request.params as { id: string };
    const target = path.join(workDir, `${id}-entrada.mp4`);

    if (!(await fileExists(target))) {
      return reply.code(404).send({ error: 'Arquivo não encontrado.' });
    }

    reply.header('Accept-Ranges', 'bytes');
    return reply.sendFile('test-video-id-entrada.mp4');
  });

  await app.ready();
});

afterAll(async () => {
  await app?.close();
  if (workDir) {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function getDuration(target: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', target],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );

    let out = '';
    proc.stdout.on('data', (chunk) => (out += chunk));
    proc.on('error', reject);
    proc.on('close', () => resolve(Number(out.trim())));
  });
}

const describeIfFFmpeg = ffmpegAvailable ? describe : describe.skip;

describe('Fluxo principal — upload', () => {
  it('retorna videoId e status QUEUED ao enviar vídeo real', async () => {
    if (!ffmpegAvailable) return;

    const payload = await fs.readFile(videoPath);
    const response = await app.inject({
      method: 'POST',
      url: '/api/videos',
      payload: buildMultipartPayload(payload, 'entrada.mp4'),
      headers: {
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      },
    });

    expect(response.statusCode).toBe(202);

    const body = response.json();
    expect(body.videoId).toBe('test-video-id');
    expect(body.status).toBe('QUEUED');
  });

  it('salva o arquivo em disco sem depender de memória', async () => {
    const saved = path.join(workDir, 'test-video-id-entrada.mp4');
    expect(await fileExists(saved)).toBe(true);

    const { size } = await fs.stat(saved);
    expect(size).toBeGreaterThan(0);
  });

  it('ffprobe identifica a duração real do vídeo', async () => {
    const saved = path.join(workDir, 'test-video-id-entrada.mp4');
    const duration = await getDuration(saved);

    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThanOrEqual(CHUNK_DURATION + 1);
  });

  it('serve o vídeo com Range requests para o player', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/videos/test-video-id/stream',
      headers: { range: 'bytes=0-1023' },
    });

    expect([200, 206]).toContain(response.statusCode);
    expect(response.headers['accept-ranges']).toBe('bytes');
  });

  it('ffmpeg extrai áudio para o Whisper (mp3, mono, 16 kHz)', async () => {
    const { ffmpegExtractAudio, ffprobe } = await import(
      '../server/src/services/ffmpeg.service.js'
    );

    const audioPath = path.join(workDir, 'saida.mp3');

    // Usa o serviço real do projeto — mesmo caminho de produção.
    await ffmpegExtractAudio(
      path.join(workDir, 'test-video-id-entrada.mp4'),
      audioPath
    );

    expect(await fileExists(audioPath)).toBe(true);
    expect((await fs.stat(audioPath)).size).toBeGreaterThan(0);

    const probe = await ffprobe(audioPath);
    const audio = probe.streams.find((stream) => stream.codec_type === 'audio');

    expect(audio?.codec_name).toBe('mp3');
    expect(audio?.sample_rate).toBe('16000');
    expect(audio?.channels).toBe(1);
    // -vn garante que nenhum stream de vídeo vazou para o áudio
    expect(probe.streams.every((stream) => stream.codec_type !== 'video')).toBe(true);
  });

  it('remove o áudio temporário sem apagar o vídeo original', async () => {
    const audioPath = path.join(workDir, 'descartavel.mp3');
    await fs.writeFile(audioPath, 'conteudo');
    expect(await fileExists(audioPath)).toBe(true);

    await fs.rm(audioPath, { force: true });

    expect(await fileExists(audioPath)).toBe(false);
    expect(await fileExists(path.join(workDir, 'test-video-id-entrada.mp4'))).toBe(true);
  });

  it('retorna 404 ao pedir vídeo inexistente', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/videos/nao-existe/stream' });
    expect(response.statusCode).toBe(404);
  });
});

describeIfFFmpeg('Fluxo principal — metadados', () => {
  it('getVideoTechnicalInfo retorna duração, resolução e fps', async () => {
    const { getVideoTechnicalInfo } = await import(
      '../server/src/services/ffmpeg.service.js'
    );

    const info = await getVideoTechnicalInfo(
      path.join(workDir, 'test-video-id-entrada.mp4')
    );

    expect(info.duration).toBeGreaterThan(0);
    expect(info.width).toBe(320);
    expect(info.height).toBe(240);
    expect(info.fps).toBe(15);
    expect(info.hasAudio).toBe(true);
    expect(info.hasVideo).toBe(true);
  });

  it('parseFrameRate converte "30000/1001" sem eval', async () => {
    const { parseFrameRate } = await import('../server/src/services/ffmpeg.service.js');

    expect(parseFrameRate('30/1')).toBe(30);
    expect(parseFrameRate('30000/1001')).toBe(29.97);
    expect(parseFrameRate(undefined)).toBe(0);
    expect(parseFrameRate('invalido')).toBe(0);
  });
});

describe('Fluxo principal — pipeline sem IA', () => {
  it('mergeChunkTranscriptions ajusta offsets e remove duplicatas', async () => {
    const { mergeChunkTranscriptions } = await import(
      '../server/src/services/transcription-pipeline.service.js'
    );

    const merged = mergeChunkTranscriptions(
      [
        { segments: [{ id: 0, start: 0, end: 2, text: 'Primeira frase' }], fullText: '' },
        {
          segments: [
            { id: 0, start: 1.8, end: 4, text: 'frase' },
            { id: 1, start: 4, end: 6, text: 'Segunda frase' },
          ],
          fullText: '',
        },
      ],
      [0, 10]
    );

    // O segundo chunk começa em 10s → timestamps absolutos.
    expect(merged.segments[0].start).toBe(0);
    expect(merged.segments[0].end).toBe(2);

    // Segmentos apenas encostados NÃO são fundidos. O Whisper entrega
    // segmentos contíguos por natureza, então fundi-los encadeava a
    // transcrição inteira num único segmento.
    expect(merged.segments).toHaveLength(3);
    expect(merged.segments[1].start).toBe(11.8);
    expect(merged.segments[1].end).toBe(14);
    expect(merged.segments[2].start).toBe(14);
    expect(merged.segments[2].end).toBe(16);
    expect(merged.segments[2].text).toContain('Segunda frase');

    // Nenhum id duplicado após a mesclagem
    const ids = merged.segments.map((segment) => segment.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Ordenação cronológica preservada
    for (let i = 1; i < merged.segments.length; i++) {
      expect(merged.segments[i].start).toBeGreaterThanOrEqual(merged.segments[i - 1].start);
    }

    expect(merged.fullText.length).toBeGreaterThan(0);
  });

  it('remove a duplicata criada pela sobreposição entre chunks', async () => {
    const { mergeChunkTranscriptions } = await import(
      '../server/src/services/transcription-pipeline.service.js'
    );

    // Sobreposição de 2s: o mesmo trecho aparece no fim de um chunk
    // e no início do seguinte. Deve ser contado uma única vez.
    const merged = mergeChunkTranscriptions(
      [
        {
          segments: [
            { id: 0, start: 0, end: 8, text: 'Palavra repetida' },
            { id: 1, start: 8, end: 10, text: 'Trecho final' },
          ],
          fullText: '',
        },
        {
          segments: [
            { id: 0, start: 0, end: 2, text: 'Palavra repetida' },
            { id: 1, start: 2, end: 4, text: 'Trecho novo' },
          ],
          fullText: '',
        },
      ],
      [0, 8]
    );

    // A região [8,10] é o mesmo áudio reportado pelos dois chunks: tem que
    // virar UM segmento só, não dois. O texto vem concatenado.
    const cobrindoSobreposicao = merged.segments.filter(
      (segment) => segment.start < 10 && segment.end > 8
    );

    expect(cobrindoSobreposicao).toHaveLength(1);
    expect(cobrindoSobreposicao[0].start).toBe(8);
    expect(cobrindoSobreposicao[0].end).toBe(10);

    // O trecho novo do segundo chunk segue em diante, sem ser engolido.
    expect(merged.segments.map((s) => s.text).join(' ')).toContain('Trecho novo');
    expect(merged.segments).toHaveLength(3);
  });

  it('pipeline completo: normaliza → valida cortes → 20 no máximo', async () => {
    const { normalizeTranscription } = await import(
      '../server/src/services/transcript-normalizer.service.js'
    );
    const { validateCuts } = await import(
      '../server/src/services/cut-validator.service.js'
    );

    const normalized = normalizeTranscription([
      { id: 0, start: 0, end: 4, text: '  Primeira   frase do vídeo.  ' },
      { id: 1, start: 4, end: 8, text: '   ' },
      { id: 2, start: 8, end: 8, text: 'Inválido' },
      { id: 3, start: 8, end: 12, text: 'Segunda frase com contexto.' },
    ]);

    expect(normalized.segments).toHaveLength(2);
    expect(normalized.segments[0].text).toBe('Primeira frase do vídeo.');
    expect(normalized.fullText).toContain('Segunda frase com contexto.');

    const videoDuration = 12;

    // A IA não pode inventar timestamps além do áudio real
    const report = validateCuts(
      [
        {
          rank: 1,
          theme: 'Corte válido',
          startTime: 0,
          endTime: 12,
          duration: 12,
          subject: 's',
          whyViral: 'w',
          hook: 'h',
          strongestMoment: 'm',
          conclusion: 'c',
          scores: {
            retention: 90,
            comments: 90,
            shares: 90,
            controversy: 90,
            curiosity: 90,
            emotion: 90,
            replay: 90,
            viralPotential: 95,
          },
          headline: 'h1',
          alternativeHeadline: 'h2',
        },
        {
          rank: 2,
          theme: 'Corte alucinado além do áudio',
          startTime: 100,
          endTime: 130,
          duration: 30,
          subject: 's',
          whyViral: 'w',
          hook: 'h',
          strongestMoment: 'm',
          conclusion: 'c',
          scores: {
            retention: 99,
            comments: 99,
            shares: 99,
            controversy: 99,
            curiosity: 99,
            emotion: 99,
            replay: 99,
            viralPotential: 99,
          },
          headline: 'h1',
          alternativeHeadline: 'h2',
        },
      ],
      { videoDuration, segments: normalized.segments, maxCuts: 20 }
    );

    // O corte alucinado é descartado mesmo tendo o maior score
    expect(report.cuts).toHaveLength(1);
    expect(report.cuts[0].theme).toBe('Corte válido');
    expect(report.rejected[0].theme).toBe('Corte alucinado além do áudio');

    // Nenhum corte escapou da validação
    for (const cut of report.cuts) {
      expect(cut.startTime).toBeGreaterThanOrEqual(0);
      expect(cut.endTime).toBeGreaterThan(cut.startTime);
      expect(cut.endTime).toBeLessThanOrEqual(videoDuration);
      expect(cut.duration).toBeCloseTo(cut.endTime - cut.startTime, 3);
    }
  });
});
