import { useEffect, useRef, useState } from 'react';

export interface SeekRequest {
  time: number;
  /** Muda a cada comando novo — permite detectar pedidos distintos. */
  id: number;
}

interface VideoClipPlayerProps {
  /** URL do vídeo (stream com suporte a Range requests). */
  videoUrl: string;
  startTime: number;
  endTime: number;
  /** Exibe os controles de início/fim/duração. */
  showInfo?: boolean;
  /**
   * Comando de salto externo (clique na transcrição, botão "IR PARA").
   * O player salta e pausa, para que o usuário possa ler com calma.
   */
  seekRequest?: SeekRequest | null;
  /** Callback com o tempo atual — permite destacar o segmento correspondente. */
  onTimeUpdate?: (time: number) => void;
}

const TOLERANCE = 0.15;

/**
 * Player de trecho: carrega o vídeo, inicia em `startTime`, reproduz
 * e pausa automaticamente em `endTime`.
 */
export function VideoClipPlayer({
  videoUrl,
  startTime,
  endTime,
  showInfo = true,
  seekRequest = null,
  onTimeUpdate,
}: VideoClipPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const hasAutoPlayedRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(startTime);
  const [error, setError] = useState<string | null>(null);

  const clipDuration = Math.max(0, endTime - startTime);

  // Reinicia o player sempre que o trecho muda.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    hasAutoPlayedRef.current = false;
    setIsPlaying(false);
    setIsReady(false);
    setError(null);
    setCurrentTime(startTime);

    // Espera os metadados para poder posicionar no startTime.
    const applyStart = () => {
      video.currentTime = startTime;
      setCurrentTime(startTime);
      setIsReady(true);
    };

    if (video.readyState >= 1) {
      applyStart();
    } else {
      video.addEventListener('loadedmetadata', applyStart, { once: true });
    }

    return () => {
      video.removeEventListener('loadedmetadata', applyStart);
    };
  }, [videoUrl, startTime, endTime]);

  // Pausa automaticamente ao atingir o fim do corte.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      onTimeUpdate?.(video.currentTime);

      if (video.currentTime >= endTime - TOLERANCE) {
        video.pause();
        video.currentTime = endTime;
        setCurrentTime(endTime);
        onTimeUpdate?.(endTime);
        setIsPlaying(false);
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, [endTime, onTimeUpdate]);

  // Salto externo (clique na transcrição, botão "IR PARA"): pausa para leitura.
  useEffect(() => {
    if (!seekRequest) return;

    const video = videoRef.current;
    if (!video) return;

    const target = Math.max(0, Math.min(seekRequest.time, endTime));

    video.pause();
    setIsPlaying(false);

    if (Math.abs(video.currentTime - target) > 0.05) {
      video.currentTime = target;
    }

    setCurrentTime(target);
    onTimeUpdate?.(target);
    // Reage apenas a comandos novos (id muda), não a cada quadro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest?.id]);

  // Limpa o loop de RAF ao desmontar.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  const play = async () => {
    const video = videoRef.current;
    if (!video) return;

    // Se já está no fim (ou além), volta ao início do corte.
    if (video.currentTime >= endTime - TOLERANCE) {
      video.currentTime = startTime;
    } else if (video.currentTime < startTime - 1) {
      video.currentTime = startTime;
    }

    try {
      await video.play();
      setIsPlaying(true);
    } catch {
      setError('Não foi possível reproduzir. Clique novamente para tentar.');
      setIsPlaying(false);
    }
  };

  const pause = () => {
    videoRef.current?.pause();
    setIsPlaying(false);
  };

  const togglePlay = () => {
    if (isPlaying) {
      pause();
    } else {
      void play();
    }
  };

  const seekWithinClip = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(time, startTime), endTime);
    setCurrentTime(video.currentTime);
    onTimeUpdate?.(video.currentTime);
  };

  const skip = (delta: number) => {
    seekWithinClip((videoRef.current?.currentTime ?? startTime) + delta);
  };

  const replay = () => {
    seekWithinClip(startTime);
    void play();
  };

  const progress =
    clipDuration > 0 ? ((currentTime - startTime) / clipDuration) * 100 : 0;

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
      <div className="relative aspect-video bg-black">
        <video
          ref={videoRef}
          src={videoUrl}
          className="h-full w-full"
          preload="metadata"
          playsInline
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onError={() => setError('Falha ao carregar o vídeo.')}
        />

        {!isPlaying && !error && (
          <button
            type="button"
            onClick={() => void play()}
            disabled={!isReady}
            className="absolute inset-0 flex items-center justify-center bg-black/40 transition-colors hover:bg-black/60 disabled:cursor-wait"
            aria-label="Reproduzir corte"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-purple-600 text-white shadow-lg transition-transform hover:scale-105">
              <svg className="ml-1 h-7 w-7" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-950/80 p-4">
            <p className="text-center text-sm text-red-300">{error}</p>
          </div>
        )}

        <div className="absolute right-2 top-2 rounded bg-black/70 px-2 py-1 font-mono text-xs text-white">
          {format(currentTime)} / {format(endTime)}
        </div>
      </div>

      {/* Progresso do trecho */}
      <div className="h-1 w-full bg-zinc-800">
        <div
          className="h-full bg-purple-500 transition-[width] duration-150"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 p-3">
        <button
          type="button"
          onClick={togglePlay}
          className="flex items-center gap-2 rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
        >
          {isPlaying ? (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
            </svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          {isPlaying ? 'PAUSAR' : 'REPRODUZIR CORTE'}
        </button>

        <button
          type="button"
          onClick={() => skip(-5)}
          className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
          title="Voltar 5 segundos"
        >
          −5s
        </button>
        <button
          type="button"
          onClick={() => skip(5)}
          className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
          title="Avançar 5 segundos"
        >
          +5s
        </button>
        <button
          type="button"
          onClick={replay}
          className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
        >
          REINICIAR
        </button>
      </div>

      {showInfo && (
        <div className="grid grid-cols-3 gap-2 border-t border-zinc-800 p-3 text-xs">
          <div>
            <p className="text-zinc-500 uppercase tracking-wide">Início</p>
            <p className="mt-0.5 font-mono text-zinc-100">{format(startTime)}</p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase tracking-wide">Fim</p>
            <p className="mt-0.5 font-mono text-zinc-100">{format(endTime)}</p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase tracking-wide">Duração</p>
            <p className="mt-0.5 font-mono text-zinc-100">{format(clipDuration)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function format(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
