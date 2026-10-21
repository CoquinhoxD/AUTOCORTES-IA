import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, videoStreamUrl } from '../services/api';
import { usePolling } from '../hooks/usePolling';
import { type AnalysisResult, type Cut, type Transcript, type VideoStatus } from '../types';
import { CutsRanking } from '../components/CutsRanking';
import { VideoClipPlayer } from '../components/VideoClipPlayer';
import { TranscriptViewer } from '../components/TranscriptViewer';
import { ProcessingProgress } from '../components/ProcessingProgress';
import { ScoreGrid } from '../components/CutCard';
import { formatDuration, formatFps, formatResolution, formatTimecode } from '../utils/format';

type Tab = 'cuts' | 'transcript';

export function AnalysisPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();

  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'cuts' | 'transcript'>('cuts');
  const [selectedCut, setSelectedCut] = useState<Cut | null>(null);
  const [playerTime, setPlayerTime] = useState<number | null>(null);
  const [seekRequest, setSeekRequest] = useState<import('../components/VideoClipPlayer').SeekRequest | null>(null);
  const [step, setStep] = useState<'QUEUED' | 'UPLOADING' | 'PROCESSING_VIDEO' | 'EXTRACTING_AUDIO' | 'TRANSCRIBING' | 'ANALYZING' | 'GENERATING_CUTS' | 'COMPLETED' | 'FAILED'>('QUEUED');
  const [progress, setProgress] = useState<number>(0);
  const [message, setMessage] = useState<string>('Iniciando processamento...');
  const [showDetails, setShowDetails] = useState<boolean>(false);

  // Enquanto o job não termina, faz polling do status.
  const isFinished = result !== null;

  const { data: status, error: statusError } = usePolling(
    () => api.getStatus(videoId!),
    {
      intervalMs: 2000,
      enabled: Boolean(videoId) && !isFinished,
      until: (data) => {
        const value = data as { status: VideoStatus };
        return value.status === 'COMPLETED' || value.status === 'FAILED';
      },
      onProgress: (step, progress, message) => {
        setStep(step as VideoStatus);
        setProgress(progress);
        setMessage(message);
      },
    }
  );

  // Carrega o resultado assim que o job conclui.
  useEffect(() => {
    if (status?.status !== 'COMPLETED' || !videoId || result) return;

    let cancelled = false;

    api
      .getResult(videoId)
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((caught) => {
        if (!cancelled) {
          setLoadError(
            caught instanceof Error ? caught.message : 'Falha ao carregar a transcrição.'
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [status?.status, videoId, result]);

  // Transcrição é carregada sob demanda, na aba correspondente.
  useEffect(() => {
    if (activeTab !== 'transcript' || transcript || !videoId) return;

    let cancelled = false;

    api
      .getTranscript(videoId)
      .then((data) => {
        if (!cancelled) setTranscript(data);
      })
      .catch((caught) => {
        if (!cancelled) {
          setLoadError(
            caught instanceof Error ? caught.message : 'Falha ao carregar a transcrição.'
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, transcript, videoId]);

  const handlePlayCut = useCallback((cut: Cut) => {
    setSelectedCut(cut);
    setSeekRequest(null);
  }, []);

  // Abre o modal apenas com os detalhes — o player fica no topo da página.
  const handleOpenDetails = useCallback((cut: Cut) => {
    setSelectedCut(cut);
    setShowDetails(true);
  }, []);

  // Salta para um timestamp (transcrição ou botão "IR PARA").
  // Incrementa `id` a cada pedido — o player distingue pedidos de eco do tempo.
  const handleSeek = useCallback((time: number) => {
    setSelectedCut(null);
    setShowDetails(false);
    setSeekRequest((current) => ({ time, id: (current?.id ?? 0) + 1 }));
  }, []);

  // Mantém a transcrição sincronizada com o player (espelho, não comando).
  const handleTimeUpdate = useCallback((time: number) => {
    setPlayerTime(time);
  }, []);

  if (!videoId) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <p className="text-sm text-zinc-400">O identificador do vídeo é inválido.</p>
      </div>
    );
  }

  if (status?.status === 'FAILED') {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <p className="text-sm text-zinc-400">Processamento falhou: {status.message}</p>
        <button
          onClick={() => navigate('/')}
          className="mt-3 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-700"
        >
          Enviar outro vídeo
        </button>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="mx-auto min-h-screen max-w-3xl px-6 py-12">
        {loadError || statusError ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <p className="text-sm text-zinc-400">
              {loadError ?? statusError}
            </p>
          </div>
        ) : (
          <ProcessingProgress
            status={step}
            progress={progress}
            message={message}
            error={status?.error}
          />
        )}
      </div>
    );
  }

  const streamUrl = videoStreamUrl(videoId);
  const topCuts = result.top5
    .map((rank) => result.cuts.find((cut) => cut.rank === rank))
    .filter((cut): cut is Cut => Boolean(cut));

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-8">
          <button
            type="button"
            onClick={() => navigate('/history')}
            className="mb-3 mr-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-200"
          >
            Histórico
          </button>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-200"
          >
            Configurações
          </button>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold text-zinc-50">{result.video.originalName}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500">
                <span>Duração: {formatDuration(result.video.duration)}</span>
                <span>{formatResolution(result.video.width, result.video.height)}</span>
                <span>{formatFps(result.video.fps)}</span>
                <span className="text-purple-400">
                  {result.generatedCuts} de {result.requestedCuts} cortes encontrados
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate(`/editor/${videoId}`)}
                className="rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
              >
                ✏️ Editar e Exportar
              </button>
            </div>
          </div>
        </header>

        {result.notice && (
          <div className="mb-6 rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
            {result.notice}
          </div>
        )}

        {/* Player principal */}
        <div className="mb-6">
          <VideoClipPlayer
            videoUrl={streamUrl}
            startTime={selectedCut?.startTime ?? 0}
            endTime={selectedCut?.endTime ?? result.video.duration}
            showInfo={Boolean(selectedCut)}
            seekRequest={seekRequest}
            onTimeUpdate={handleTimeUpdate}
          />
          {selectedCut && (
            <div className="mt-2 flex items-center justify-between">
              <p className="text-sm text-zinc-400">
                Reproduzindo: <span className="text-zinc-200">{selectedCut.theme}</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelectedCut(null);
                  setShowDetails(false);
                }}
                className="text-sm text-zinc-500 hover:text-zinc-200"
              >
                Ver vídeo inteiro
              </button>
            </div>
          )}
        </div>

        {/* Abas */}
        <div className="mb-5 flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          {
            [
              { id: 'cuts' as Tab, label: `Cortes (${result.cuts.length})` },
              { id: 'transcript' as Tab, label: 'Transcrição' },
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-100'}`}
                >
                  {tab.label}
                </button>
              );
            })}
        </div>

        {activeTab === 'cuts' ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <CutsRanking
              cuts={result.cuts}
              top5={result.top5}
              onPlay={handlePlayCut}
              onDetails={handleOpenDetails}
              onSeek={handleSeek}
            />

            <aside className="space-y-4">
              {topCuts.length > 0 && (
                <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                  <h2 className="mb-3 text-sm font-semibold text-zinc-100">🔥 TOP 5</h2>
                  <ol className="space-y-2">
                    {topCuts.map((cut) => (
                      <li key={cut.id}>
                        <button
                          type="button"
                          onClick={() => handlePlayCut(cut)}
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-left transition-colors hover:border-purple-800"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-amber-500">
                              #{cut.rank}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
                              {cut.theme}
                            </span>
                            <span className="font-mono text-xs text-purple-400">
                              {cut.viralPotential}
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {result.controversies.length > 0 && (
                <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                  <h2 className="mb-3 text-sm font-semibold text-zinc-100">
                    🔥 Pontos Polêmicos
                  </h2>
                  <ul className="space-y-2">
                    {result.controversies.map((controversy, index) => (
                      <li
                        key={index}
                        className="rounded-lg border border-orange-900/40 bg-orange-950/20 p-2.5 text-xs leading-relaxed text-orange-200"
                      >
                        {controversy}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {result.cuts.length > 0 && (
                <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                  <h2 className="mb-3 text-xs font-semibold text-zinc-100">
                    Total de cortes: {result.cuts.length}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    {result.generatedCuts} gerados de {result.requestedCuts} solicitados
                  </p>
                </section>
              )}

              {transcript ? (
                <TranscriptViewer
                  segments={transcript.segments}
                  onSeek={handleSeek}
                  activeTime={selectedCut?.startTime ?? playerTime}
                />
              ) : (
                <div></div>
              )}
            </aside>
          </div>
        ) : (
          <TranscriptViewer
            segments={transcript?.segments ?? []}
            onSeek={handleSeek}
            activeTime={selectedCut?.startTime ?? playerTime}
          />
        )}

        {/* Modal apenas com detalhes — a reprodução fica no player principal */}
        {showDetails && selectedCut && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4 sm:p-8"
            role="dialog"
            aria-modal="true"
            aria-label={`Detalhes do corte ${selectedCut.rank}`}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setShowDetails(false);
              }
            }}
          >
            <div className="my-8 w-full max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-900">
              <header className="flex items-start justify-between gap-4 border-b border-zinc-800 p-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-purple-600 px-2 py-0.5 font-mono text-xs font-bold text-white">
                      #{selectedCut.rank}
                    </span>
                    <span className="font-mono text-xs text-zinc-500">
                      {formatTimecode(selectedCut.startTime, true)} → {formatTimecode(selectedCut.endTime, true)} ·{' '}
                      {selectedCut.duration.toFixed(1).replace('.', ',')}s
                    </span>
                  </div>
                  <h2 className="mt-2 text-lg font-bold text-zinc-50">{selectedCut.theme}</h2>
                </div>

                <button
                  type="button"
                  onClick={() => setShowDetails(false)}
                  className="shrink-0 rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                  aria-label="Fechar detalhes"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </header>

              <div className="space-y-5 p-5">
                <section className="rounded-lg border border-purple-900/50 bg-purple-950/20 p-4">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-purple-400">
                    Headline
                  </h3>
                  <p className="mt-1 text-base font-semibold text-zinc-50">"{selectedCut.headline}"</p>
                </section>

                <section className="grid gap-4 sm:grid-cols-2">
                  <Detail label="Assunto">{selectedCut.subject}</Detail>
                  <Detail label="Por que pode viralizar">{selectedCut.whyViral}</Detail>
                  <Detail label="Gancho">{selectedCut.hook}</Detail>
                  <Detail label="Momento mais forte">{selectedCut.strongestMoment}</Detail>
                  <Detail label="Conclusão">{selectedCut.conclusion}</Detail>
                  <Detail label="Headline alternativa">{selectedCut.alternativeHeadline}</Detail>
                </section>

                <section>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Scores
                  </h3>
                  <ScoreGrid cut={selectedCut} />
                </section>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
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