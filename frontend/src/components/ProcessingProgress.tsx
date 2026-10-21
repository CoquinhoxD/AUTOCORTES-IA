import { JOB_STEPS, type VideoStatus } from '../types';

const STEP_STATUSES: VideoStatus[] = JOB_STEPS.map((step) => step.status);

const LABELS: Record<VideoStatus, string> = {
  QUEUED: 'Na fila',
  UPLOADING: 'Enviando',
  PROCESSING_VIDEO: 'Lendo vídeo',
  EXTRACTING_AUDIO: 'Extraindo áudio',
  TRANSCRIBING: 'Transcrevendo',
  ANALYZING: 'Analisando com IA',
  GENERATING_CUTS: 'Selecionando cortes',
  COMPLETED: 'Concluído',
  FAILED: 'Falhou',
};

interface ProcessingProgressProps {
  status: VideoStatus;
  progress: number;
  message: string;
  error?: string | null;
}

export function ProcessingProgress({ status, progress, message, error }: ProcessingProgressProps) {
  const currentIndex = STEP_STATUSES.indexOf(status);
  const isFailed = status === 'FAILED';
  const isCompleted = status === 'COMPLETED';

  return (
    <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                isFailed
                  ? 'bg-red-500'
                  : isCompleted
                    ? 'bg-emerald-500'
                    : 'animate-pulse bg-purple-500'
              }`}
            />
            <h3 className="font-semibold text-zinc-100">
              {isFailed ? 'Processamento falhou' : 'Processando vídeo'}
            </h3>
          </div>
          <p className="mt-1 text-sm text-zinc-400">{message}</p>
        </div>

        <span
          className={`font-mono text-2xl font-bold ${
            isFailed ? 'text-red-400' : isCompleted ? 'text-emerald-400' : 'text-purple-400'
          }`}
        >
          {progress}%
        </span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full transition-[width] duration-500 ${
            isFailed ? 'bg-red-500' : isCompleted ? 'bg-emerald-500' : 'bg-purple-600'
          }`}
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>

      {/* Trilha de etapas */}
      <ol className="space-y-1.5">
        {JOB_STEPS.filter((step) => step.status !== 'COMPLETED').map((step, index) => {
          const stepIndex = STEP_STATUSES.indexOf(step.status);
          const isDone = currentIndex > stepIndex;
          const isCurrent = status === step.status;

          return (
            <li key={step.status} className="flex items-center gap-2 text-xs">
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] ${
                  isDone
                    ? 'border-emerald-500 bg-emerald-500 text-zinc-900'
                    : isCurrent
                      ? 'border-purple-500 bg-purple-500 text-white'
                      : isFailed && stepIndex > currentIndex
                        ? 'border-zinc-800 text-zinc-700'
                        : 'border-zinc-700 text-zinc-600'
                }`}
              >
                {isDone ? '✓' : index + 1}
              </span>
              <span className={isCurrent ? 'text-zinc-100' : 'text-zinc-500'}>
                {LABELS[step.status]}
              </span>
              {isCurrent && (
                <span className="ml-auto font-mono text-zinc-600">{step.progress}%</span>
              )}
            </li>
          );
        })}
      </ol>

      {isFailed && error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-400">
            Detalhe do erro
          </p>
          <p className="mt-1 text-sm leading-relaxed text-red-200">{error}</p>
        </div>
      )}
    </div>
  );
}
