import { createHash } from 'crypto';

export interface VideoProcessingJob {
  id: string;
  videoId: string;
  status: VideoJobStatus;
  progress: number;
  currentStep: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type VideoJobStatus =
  | 'QUEUED'
  | 'PROCESSING_VIDEO'
  | 'EXTRACTING_AUDIO'
  | 'TRANSCRIBING'
  | 'ANALYZING'
  | 'GENERATING_CUTS'
  | 'COMPLETED'
  | 'FAILED';

export interface StepDefinition {
  status: VideoJobStatus;
  progress: number;
  message: string;
}

/** Estados e progresso canônicos — mesma ordem usada no frontend. */
export const JOB_STEPS: StepDefinition[] = [
  { status: 'QUEUED', progress: 0, message: 'Na fila de processamento...' },
  { status: 'PROCESSING_VIDEO', progress: 10, message: 'Obtendo metadados do vídeo...' },
  { status: 'EXTRACTING_AUDIO', progress: 30, message: 'Extraindo áudio...' },
  { status: 'TRANSCRIBING', progress: 50, message: 'Gerando transcrição...' },
  { status: 'ANALYZING', progress: 70, message: 'Analisando conteúdo com IA...' },
  { status: 'GENERATING_CUTS', progress: 90, message: 'Selecionando os melhores cortes...' },
  { status: 'COMPLETED', progress: 100, message: 'Processamento concluído' },
];

export function getStepDefinition(status: VideoJobStatus): StepDefinition {
  return (
    JOB_STEPS.find((step) => step.status === status) ?? {
      status,
      progress: 0,
      message: status === 'FAILED' ? 'Processamento falhou' : status,
    }
  );
}

export function isTerminalStatus(status: VideoJobStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED';
}

/**
 * Ordem válida de transições. Um job não pode pular etapas incoerentes.
 */
export const VALID_TRANSITIONS: Record<VideoJobStatus, VideoJobStatus[]> = {
  QUEUED: ['PROCESSING_VIDEO', 'FAILED'],
  PROCESSING_VIDEO: ['EXTRACTING_AUDIO', 'FAILED'],
  EXTRACTING_AUDIO: ['TRANSCRIBING', 'FAILED'],
  TRANSCRIBING: ['ANALYZING', 'FAILED'],
  ANALYZING: ['GENERATING_CUTS', 'FAILED'],
  GENERATING_CUTS: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
};

export function canTransition(from: VideoJobStatus, to: VideoJobStatus): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Chave de idempotência para BullMQ futuramente. */
export function buildJobId(videoId: string, attempt: number = 1): string {
  return `video:${videoId}:${attempt}`;
}

export function buildQueueName(): string {
  return process.env.JOB_QUEUE_NAME || 'viral-cut-processing';
}

/** Hash do conteúdo — permite deduplicar jobs futuros pelo arquivo. */
export function contentHash(buffer: Buffer | string): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export interface JobProgressUpdate {
  status: VideoJobStatus;
  progress: number;
  message: string;
}

export function buildProgressUpdate(status: VideoJobStatus, customMessage?: string): JobProgressUpdate {
  const step = getStepDefinition(status);
  return {
    status,
    progress: step.progress,
    message: customMessage ?? step.message,
  };
}
