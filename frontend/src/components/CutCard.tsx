import { SCORE_LABELS, type Cut, type CutScores } from '../types';
import { formatDurationShort, formatTimecode, scoreTone } from '../utils/format';

const TONE_CLASSES: Record<'high' | 'medium' | 'low', string> = {
  high: 'text-emerald-400',
  medium: 'text-amber-400',
  low: 'text-red-400',
};

const TONE_BAR_CLASSES: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-emerald-500',
  medium: 'bg-amber-500',
  low: 'bg-red-500',
};

interface ScoreGridProps {
  cut: Cut;
  compact?: boolean;
}

export function ScoreGrid({ cut, compact = false }: ScoreGridProps) {
  const scores: CutScores = cut;

  return (
    <div
      className={
        compact
          ? 'grid grid-cols-2 gap-2 sm:grid-cols-4'
          : 'grid grid-cols-2 gap-3 sm:grid-cols-4'
      }
    >
      {SCORE_LABELS.map(({ key, label }) => {
        const value = scores[key];
        const tone = scoreTone(value);

        return (
          <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              {label}
            </p>
            <p className={`mt-1 font-mono text-xl font-bold ${TONE_CLASSES[tone]}`}>{value}</p>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full ${TONE_BAR_CLASSES[tone]}`}
                style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface CutCardProps {
  cut: Cut;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
  onPlay: () => void;
  onDetails: () => void;
  onSeek: (time: number) => void;
  isTop5: boolean;
}

export function CutCard({
  cut,
  rank,
  expanded,
  onToggle,
  onPlay,
  onDetails,
  onSeek,
  isTop5,
}: CutCardProps) {
  const tone = scoreTone(cut.viralPotential);

  return (
    <article className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 transition-colors hover:border-zinc-700">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-zinc-800/60"
        aria-expanded={expanded}
      >
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-bold text-white ${
            isTop5 ? 'bg-amber-500 text-zinc-900' : 'bg-purple-600'
          }`}
        >
          {rank}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-zinc-100">{cut.theme}</p>
          <p className="mt-0.5 font-mono text-xs text-zinc-400">
            {formatTimecode(cut.startTime, true)} → {formatTimecode(cut.endTime, true)} ·{' '}
            {formatDurationShort(cut.duration)}
          </p>
          <p className="mt-1 truncate text-xs text-zinc-500">{cut.headline}</p>
        </div>

        <div className="shrink-0 text-right">
          <p className={`font-mono text-2xl font-bold ${TONE_CLASSES[tone]}`}>
            {cut.viralPotential}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Potencial</p>
        </div>

        <svg
          className={`h-5 w-5 shrink-0 text-zinc-500 transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded && (
        <div className="space-y-5 border-t border-zinc-800 bg-zinc-950 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Detail label="Assunto">{cut.subject}</Detail>
            <Detail label="Por que pode viralizar">{cut.whyViral}</Detail>
            <Detail label="Gancho">{cut.hook}</Detail>
            <Detail label="Momento mais forte">{cut.strongestMoment}</Detail>
            <Detail label="Conclusão">{cut.conclusion}</Detail>
            <Detail label="Headline alternativa">{cut.alternativeHeadline}</Detail>
          </div>

          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Scores
            </h4>
            <ScoreGrid cut={cut} />
          </div>

          <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-4">
            <button
              type="button"
              onClick={onPlay}
              className="rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
            >
              ▶ VER TRECHO
            </button>
            <button
              type="button"
              onClick={onDetails}
              className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
            >
              VER DETALHES
            </button>
            <button
              type="button"
              onClick={() => onSeek(cut.startTime)}
              className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
            >
              IR PARA {formatTimecode(cut.startTime)}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function Detail({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </h4>
      <p className="mt-1 text-sm leading-relaxed text-zinc-200">{children}</p>
    </div>
  );
}
