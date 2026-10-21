import type { VideoJobStatus, VideoProcessingJob } from '../types/job.js';
import { buildProgressUpdate, isTerminalStatus, getStepDefinition } from '../types/job.js';

export interface JobRepository {
  create(job: { videoId: string }): Promise<VideoProcessingJob>;
  updateStatus(videoId: string, status: VideoJobStatus, error?: string | null): Promise<void>;
  findByVideoId(videoId: string): Promise<VideoProcessingJob | null>;
  list(limit?: number): Promise<VideoProcessingJob[]>;
}

/**
 * Fila em memória para desenvolvimento.
 *
 * A interface imita o contrato que o BullMQ usará na produção, para que
 * a substituição não exija reescrever os serviços:
 *
 *   BullMQ:
 *     await queue.add(buildJobName(videoId), { videoId }, {
 *       jobId: buildJobId(videoId),
 *       attempts: 3,
 *       backoff: { type: 'exponential', delay: 5000 },
 *       removeOnComplete: 100,
 *       removeOnFail: 500,
 *     });
 *
 * A fila é sequencial por padrão (FFmpeg e CPU são recursos limitados),
 * mas `concurrency` pode ser Aumentado com `setConcurrency`.
 */
export class InMemoryJobQueue {
  private readonly queue: Array<{ videoId: string }> = [];
  private readonly processing = new Set<string>();
  private concurrency = 1;
  private draining = false;

  constructor(private readonly repository: JobRepository) {}

  setConcurrency(value: number): void {
    this.concurrency = Math.max(1, value);
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.processing.size;
  }

  async enqueue(videoId: string): Promise<void> {
    this.queue.push({ videoId });
    console.log(`[QUEUE] Job enfileirado: ${videoId} (fila: ${this.queue.length})`);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.queue.length > 0 && this.processing.size < this.concurrency) {
        const next = this.queue.shift();
        if (!next) break;

        this.processing.add(next.videoId);
        void this.execute(next.videoId);
      }
    } finally {
      this.draining = false;
    }
  }

  private async execute(videoId: string): Promise<void> {
    const job = await this.repository.findByVideoId(videoId);

    if (!job || isTerminalStatus(job.status)) {
      this.processing.delete(videoId);
      void this.drain();
      return;
    }

    const handler = this.handlers.get(videoId);

    if (!handler) {
      console.error(`[QUEUE] Nenhum handler registrado para ${videoId}`);
      this.processing.delete(videoId);
      void this.drain();
      return;
    }

    try {
      await handler(videoId);
    } catch (error) {
      // A mensagem já é registrada em log pelo handler (que conhece o
      // contexto do pipeline). Aqui evitamos duplicar o stack trace.
      console.error(`[QUEUE] Job ${videoId} falhou: ${(error as Error).message}`);
      await this.repository.updateStatus(videoId, 'FAILED', (error as Error).message);
    } finally {
      this.processing.delete(videoId);
      void this.drain();
    }
  }

  private readonly handlers = new Map<string, (videoId: string) => Promise<void>>();

  registerHandler(videoId: string, handler: (videoId: string) => Promise<void>): void {
    this.handlers.set(videoId, handler);
  }

  /**
   * Atualiza o job no repositório com a mensagem canônica do passo.
   * Em produção, equivalente a `await job.updateProgress(data)`.
   */
  async advance(videoId: string, status: VideoJobStatus, customMessage?: string): Promise<void> {
    const update = buildProgressUpdate(status, customMessage);
    console.log(`[${status}] ${update.message}`);
    await this.repository.updateStatus(videoId, status, null);
  }

  static messageFor(status: VideoJobStatus): string {
    return getStepDefinition(status).message;
  }
}
