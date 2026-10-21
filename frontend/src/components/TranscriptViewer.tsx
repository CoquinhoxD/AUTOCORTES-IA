import { useEffect, useRef, useState } from 'react';
import type { TranscriptSegment } from '../types';
import { formatTimecode } from '../utils/format';

interface TranscriptViewerProps {
  segments: TranscriptSegment[];
  onSeek: (time: number) => void;
  activeTime?: number | null;
}

/**
 * Exibe todos os segmentos da transcrição com timestamps.
 * Clicar em um segmento posiciona o player naquele timestamp.
 */
export function TranscriptViewer({ segments, onSeek, activeTime }: TranscriptViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);

  const normalizedFilter = filter.trim().toLowerCase();

  const visible = normalizedFilter
    ? segments.filter((segment) =>
        segment.text.toLowerCase().includes(normalizedFilter)
      )
    : segments;

  // Rola automaticamente até o segmento correspondente ao trecho em reprodução.
  useEffect(() => {
    if (!autoScroll || activeTime == null || !containerRef.current) return;

    const target = segments.find(
      (segment) => activeTime >= segment.start && activeTime <= segment.end
    );
    if (!target) return;

    const element = containerRef.current.querySelector<HTMLElement>(
      `[data-segment-index="${target.id}"]`
    );
    element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeTime, segments, autoScroll]);

  if (segments.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-400">
        Nenhum segmento de transcrição disponível.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1">
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Buscar na transcrição..."
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-purple-600"
          />
        </div>

        <span className="text-xs text-zinc-500">
          {visible.length} de {segments.length} segmentos
        </span>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(event) => setAutoScroll(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-800 accent-purple-600"
          />
          Acompanhar player
        </label>
      </div>

      <div
        ref={containerRef}
        className="max-h-[560px] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900"
      >
        {visible.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500">
            Nenhum segmento contém “{filter}”.
          </p>
        ) : (
          visible.map((segment) => {
            const isActive =
              activeTime != null && activeTime >= segment.start && activeTime <= segment.end;

            return (
              <button
                key={segment.id}
                type="button"
                data-segment-index={segment.id}
                onClick={() => onSeek(segment.start)}
                className={`flex w-full gap-3 border-b border-zinc-800/60 p-3 text-left transition-colors last:border-b-0 ${
                  isActive ? 'bg-purple-950/50' : 'hover:bg-zinc-800/60'
                }`}
              >
                <span
                  className={`shrink-0 font-mono text-xs ${
                    isActive ? 'text-purple-400' : 'text-zinc-500'
                  }`}
                >
                  {formatTimecode(segment.start, true)}
                </span>
                <span
                  className={`text-sm leading-relaxed ${
                    isActive ? 'text-zinc-100' : 'text-zinc-300'
                  }`}
                >
                  {segment.text}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
