import { useState } from 'react';
import type { Cut } from '../types';
import { CutCard } from './CutCard';

interface CutsRankingProps {
  cuts: Cut[];
  top5: number[];
  onPlay: (cut: Cut) => void;
  onDetails: (cut: Cut) => void;
  onSeek: (time: number) => void;
}

export function CutsRanking({ cuts, top5, onPlay, onDetails, onSeek }: CutsRankingProps) {
  const [expandedRank, setExpandedRank] = useState<number | null>(null);

  if (cuts.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
        <p className="text-zinc-400">Nenhum corte foi gerado para este vídeo.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">
          🏆 Cortes <span className="text-zinc-500">({cuts.length})</span>
        </h2>
        <p className="text-xs text-zinc-500">Clique para ver os detalhes</p>
      </div>

      {cuts.map((cut) => (
        <CutCard
          key={cut.id}
          cut={cut}
          rank={cut.rank}
          isTop5={top5.includes(cut.rank)}
          expanded={expandedRank === cut.rank}
          onToggle={() =>
            setExpandedRank((current) => (current === cut.rank ? null : cut.rank))
          }
          onPlay={() => onPlay(cut)}
          onDetails={() => onDetails(cut)}
          onSeek={onSeek}
        />
      ))}
    </div>
  );
}
