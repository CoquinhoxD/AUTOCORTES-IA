import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { HistoryEntry, VideoStatus } from '../types';
import { formatDate, formatDuration, formatResolution, scoreTone } from '../utils/format';

const STATUS_STYLES: Record<VideoStatus, string> = {
  QUEUED: 'bg-zinc-700 text-zinc-300',
  UPLOADING: 'bg-zinc-700 text-zinc-300',
  PROCESSING_VIDEO: 'bg-purple-600/20 text-purple-300',
  EXTRACTING_AUDIO: 'bg-purple-600/20 text-purple-300',
  TRANSCRIBING: 'bg-purple-600/20 text-purple-300',
  ANALYZING: 'bg-purple-600/20 text-purple-300',
  GENERATING_CUTS: 'bg-purple-600/20 text-purple-300',
  COMPLETED: 'bg-emerald-600/20 text-emerald-300',
  FAILED: 'bg-red-600/20 text-red-300',
};

const STATUS_LABELS: Record<VideoStatus, string> = {
  QUEUED: 'Na fila',
  UPLOADING: 'Enviando',
  PROCESSING_VIDEO: 'Lendo vídeo',
  EXTRACTING_AUDIO: 'Extraindo áudio',
  TRANSCRIBING: 'Transcrevendo',
  ANALYZING: 'Analisando',
  GENERATING_CUTS: 'Gerando cortes',
  COMPLETED: 'Concluído',
  FAILED: 'Falhou',
};

export function HistoryPage() {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .getHistory()
      .then((response) => {
        if (!cancelled) setVideos(response.videos);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : 'Falha ao carregar o histórico.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-50">Histórico</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {videos.length} {videos.length === 1 ? 'vídeo analisado' : 'vídeos analisados'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/settings"
              className="rounded-lg border border-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
            >
              Configurações
            </Link>

            <Link
              to="/"
              className="rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
            >
              Analisar novo vídeo
            </Link>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-zinc-500">Carregando histórico...</div>
        ) : videos.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 py-16 text-center">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-800 text-zinc-600">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </span>
            <p className="text-zinc-300">Nenhum vídeo analisado ainda</p>
            <p className="mt-1 text-sm text-zinc-500">
              Envie seu primeiro vídeo para ver os cortes aqui.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((video) => {
              const isDone = video.status === 'COMPLETED';
              const topCut = video.topCut;
              const tone = topCut ? scoreTone(topCut.viralPotential) : null;

              return (
                <li key={video.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/analysis/${video.id}`)}
                    className="group flex h-full w-full flex-col rounded-xl border border-zinc-800 bg-zinc-900 p-5 text-left transition-colors hover:border-purple-800 hover:bg-zinc-800/50"
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-500 transition-colors group-hover:bg-purple-950/50 group-hover:text-purple-400">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </span>

                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${STATUS_STYLES[video.status]}`}
                      >
                        {STATUS_LABELS[video.status]}
                      </span>
                    </div>

                    <h2 className="mb-3 line-clamp-2 text-sm font-semibold text-zinc-100">
                      {video.originalName}
                    </h2>

                    <dl className="space-y-1 text-xs text-zinc-500">
                      <div className="flex justify-between">
                        <dt>Data</dt>
                        <dd className="text-zinc-400">{formatDate(video.createdAt)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Duração</dt>
                        <dd className="text-zinc-400">{formatDuration(video.duration)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Resolução</dt>
                        <dd className="text-zinc-400">
                          {formatResolution(video.width, video.height)}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-4 border-t border-zinc-800 pt-3">
                      {isDone && topCut ? (
                        <>
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                            TOP 1 — {topCut.theme}
                          </p>
                          <div className="mt-1 flex items-baseline justify-between">
                            <p className="truncate pr-2 text-xs text-zinc-400">
                              {topCut.headline}
                            </p>
                            <p
                              className={`font-mono text-xl font-bold ${
                                tone === 'high'
                                  ? 'text-emerald-400'
                                  : tone === 'medium'
                                    ? 'text-amber-400'
                                    : 'text-red-400'
                              }`}
                            >
                              {topCut.viralPotential}
                            </p>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-zinc-600">
                          {video.status === 'FAILED'
                            ? 'Processamento falhou'
                            : 'Processamento em andamento'}
                        </p>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
