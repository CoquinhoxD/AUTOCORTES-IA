// ============================================================
// Tipos compartilhados com o backend (server/src/types, dto.ts)
// ============================================================

export type VideoStatus =
  | 'QUEUED'
  | 'UPLOADING'
  | 'PROCESSING_VIDEO'
  | 'EXTRACTING_AUDIO'
  | 'TRANSCRIBING'
  | 'ANALYZING'
  | 'GENERATING_CUTS'
  | 'COMPLETED'
  | 'FAILED';

export const TERMINAL_STATUSES: VideoStatus[] = ['COMPLETED', 'FAILED'];

/** Passos canônicos — espelham backend/server/src/types/job.ts */
export const JOB_STEPS: Array<{ status: VideoStatus; progress: number; message: string }> = [
  { status: 'QUEUED', progress: 0, message: 'Na fila de processamento...' },
  { status: 'PROCESSING_VIDEO', progress: 10, message: 'Obtendo metadados do vídeo...' },
  { status: 'EXTRACTING_AUDIO', progress: 30, message: 'Extraindo áudio...' },
  { status: 'TRANSCRIBING', progress: 50, message: 'Gerando transcrição...' },
  { status: 'ANALYZING', progress: 70, message: 'Analisando conteúdo com IA...' },
  { status: 'GENERATING_CUTS', progress: 90, message: 'Selecionando os melhores cortes...' },
  { status: 'COMPLETED', progress: 100, message: 'Processamento concluído' },
];

export function isTerminal(status: VideoStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface JobStatus {
  status: VideoStatus;
  progress: number;
  message: string;
  error: string | null;
}

export interface CutScores {
  retentionScore: number;
  commentsScore: number;
  sharesScore: number;
  controversyScore: number;
  curiosityScore: number;
  emotionScore: number;
  replayScore: number;
  viralPotential: number;
}

export interface Cut extends CutScores {
  id: string;
  videoId: string;
  rank: number;
  startTime: number;
  endTime: number;
  duration: number;
  theme: string;
  subject: string;
  whyViral: string;
  hook: string;
  strongestMoment: string;
  conclusion: string;
  headline: string;
  alternativeHeadline: string;
  createdAt: string;
}

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  id: string;
  language: string;
  provider: string;
  fullText: string;
  segments: TranscriptSegment[];
}

export interface VideoSummary {
  id: string;
  originalName: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  status: VideoStatus;
  createdAt: string;
}

export interface RejectedCut {
  rank: number;
  theme: string;
  reason: string;
}

export interface AnalysisResult {
  video: VideoSummary & { streamUrl: string };
  cuts: Cut[];
  controversies: string[];
  top5: number[];
  requestedCuts: number;
  generatedCuts: number;
  notice: string | null;
  rejected: RejectedCut[];
}

export interface HistoryEntry extends VideoSummary {
  topCut: {
    rank: number;
    theme: string;
    viralPotential: number;
    headline: string;
  } | null;
}

export interface HistoryResponse {
  videos: HistoryEntry[];
}

export interface UploadResponse {
  videoId: string;
  status: VideoStatus;
}

/** Rótulos e cores por score, compartilhados entre os cards. */
export const SCORE_LABELS: Array<{ key: keyof CutScores; label: string }> = [
  { key: 'retentionScore', label: 'Retenção' },
  { key: 'commentsScore', label: 'Comentários' },
  { key: 'sharesScore', label: 'Compartilhamentos' },
  { key: 'controversyScore', label: 'Polêmica' },
  { key: 'curiosityScore', label: 'Curiosidade' },
  { key: 'emotionScore', label: 'Emoção' },
  { key: 'replayScore', label: 'Replay' },
  { key: 'viralPotential', label: 'Potencial Viral' },
];
