import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, API_BASE_URL } from '../services/api';
import { validateVideoFile } from '../utils/validation';
import { formatBytes } from '../utils/format';
import { ALLOWED_VIDEO_EXTENSIONS } from '../utils/validation';

const DEFAULT_MAX_MB = 5120;  // 5GB - limite máximo configurado
const ALLOWED_SUBTITLE_EXTENSIONS = ['.srt', '.vtt'];

export function UploadPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxSizeMb, setMaxSizeMb] = useState(DEFAULT_MAX_MB);
  const [srtFile, setSrtFile] = useState<File | null>(null);
  const [importingSrt, setImportingSrt] = useState(false);

  // Descobre o limite real configurado no backend.
  useEffect(() => {
    let cancelled = false;

    api
      .getHealth()
      .then((health) => {
        if (!cancelled && health.maxVideoSizeMb > 0) {
          setMaxSizeMb(health.maxVideoSizeMb);
        }
      })
      .catch(() => {
        // mantém o padrão caso o backend ainda não responda
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectFile = useCallback(
    (candidate: File | null) => {
      setError(null);
      if (!candidate) return;

      const validation = validateVideoFile(candidate, maxSizeMb);
      if (!validation.valid) {
        setFile(null);
        setError(validation.error ?? 'Arquivo inválido.');
        return;
      }

      setFile(candidate);
    },
    [maxSizeMb]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!file) {
      setError('Selecione um vídeo para analisar.');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const response = await api.upload(file);
      navigate(`/analysis/${response.videoId}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Falha ao enviar o vídeo. Tente novamente.'
      );
      setIsUploading(false);
    }
  };

  const maxLabel =
    maxSizeMb >= 1024
      ? `${(maxSizeMb / 1024).toFixed(maxSizeMb % 1024 === 0 ? 0 : 1).replace('.', ',')} GB`
      : `${maxSizeMb} MB`;

  const selectSrtFile = useCallback((candidate: File | null) => {
    setError(null);
    if (!candidate) return;
    const ext = candidate.name.toLowerCase().split('.').pop();
    if (!['srt', 'vtt'].includes(ext ?? '')) {
      setError('Formato de legenda não suportado. Use .srt ou .vtt');
      return;
    }
    setSrtFile(candidate);
  }, []);

  const handleSrtImport = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!file || !srtFile) {
      setError('Selecione um vídeo e um arquivo de legenda (.srt/.vtt).');
      return;
    }

    setImportingSrt(true);
    setError(null);

    try {
      // 1. Upload do vídeo
      const uploadResponse = await api.upload(file);
      const videoId = uploadResponse.videoId;

      // 2. Importar SRT
      const formData = new FormData();
      formData.append('file', srtFile);
      await fetch(`${API_BASE_URL}/api/videos/${videoId}/import-srt`, {
        method: 'POST',
        body: formData,
      });

      navigate(`/analysis/${videoId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao importar legenda.');
      setImportingSrt(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
        <header className="mb-8 text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-purple-800/60 bg-purple-950/40 px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
            <span className="text-xs font-medium text-purple-300">Viral Cut AI</span>
          </div>

          <h1 className="text-3xl font-bold leading-tight text-zinc-50 sm:text-4xl">
            Encontre os melhores cortes do seu vídeo
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-zinc-400">
            Envie um vídeo e deixe a IA encontrar os momentos com maior potencial.
          </p>

          <div className="mt-5 flex items-center justify-center gap-5 text-sm">
            <button
              type="button"
              onClick={() => navigate('/history')}
              className="text-zinc-500 transition-colors hover:text-zinc-200"
            >
              Histórico
            </button>
            <span className="text-zinc-800">•</span>
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="inline-flex items-center gap-1.5 text-zinc-500 transition-colors hover:text-zinc-200"
            >
              Configurações
            </button>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Área drag & drop */}
          <div
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              event.preventDefault();
              setIsDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              selectFile(event.dataTransfer.files[0] ?? null);
            }}
            className={`relative rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
              isDragging
                ? 'border-purple-500 bg-purple-950/30'
                : file
                  ? 'border-purple-700 bg-purple-950/20'
                  : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ALLOWED_VIDEO_EXTENSIONS.join(',')}
              onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
              className="sr-only"
              disabled={isUploading}
            />

            {file ? (
              <div className="flex flex-col items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-600/20 text-purple-400">
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6M15 13l-3 3m0 0l-3-3m3 3V12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <p className="font-medium text-zinc-100">{file.name}</p>
                  <p className="mt-0.5 text-sm text-zinc-500">
                    {formatBytes(file.size)} · {file.type || 'tipo desconhecido'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={isUploading}
                  className="text-sm font-medium text-purple-400 hover:text-purple-300 disabled:opacity-50"
                >
                  Trocar arquivo
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-800 text-zinc-500">
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 16V4m0 12l-4-4m4 4l4-4M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <p className="text-zinc-300">Arraste e solte seu vídeo aqui</p>
                <p className="text-sm text-zinc-500">ou</p>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="rounded-lg bg-zinc-800 px-5 py-2.5 text-sm font-semibold text-zinc-100 transition-colors hover:bg-zinc-700"
                >
                  SELECIONAR VÍDEO
                </button>
                <p className="mt-1 text-xs text-zinc-600">
                  {ALLOWED_VIDEO_EXTENSIONS.join(' · ')} — máx. {maxLabel}
                </p>
              </div>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!file || isUploading}
            className={`w-full rounded-xl py-3.5 text-base font-bold tracking-wide transition-colors ${
              file && !isUploading
                ? 'bg-purple-600 text-white hover:bg-purple-700'
                : 'cursor-not-allowed bg-zinc-800 text-zinc-600'
            }`}
          >
            {isUploading ? 'ENVIANDO...' : 'ANALISAR VÍDEO'}
          </button>

          {isUploading && (
            <p className="text-center text-xs text-zinc-500">
              Vídeos grandes podem levar alguns minutos para enviar.
            </p>
          )}
        </form>

        {/* Seção de importação de legenda SRT/VTT */}
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h3 className="mb-4 font-medium text-zinc-300 flex items-center gap-2">
            <svg className="h-5 w-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            Importar legenda existente (SRT/VTT)
          </h3>
          <p className="mb-4 text-sm text-zinc-500">
            Já tem a transcrição? Envie o vídeo junto com um arquivo .srt ou .vtt para pular a etapa de transcrição.
          </p>
          <form onSubmit={handleSrtImport} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Vídeo</label>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ALLOWED_VIDEO_EXTENSIONS.join(',')}
                  onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
                  disabled={isUploading || importingSrt}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-purple-600 file:text-white hover:file:bg-purple-700"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Legenda (SRT/VTT)</label>
                <input
                  type="file"
                  accept={ALLOWED_SUBTITLE_EXTENSIONS.join(',')}
                  onChange={(event) => selectSrtFile(event.target.files?.[0] ?? null)}
                  disabled={isUploading || importingSrt}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-amber-600 file:text-white hover:file:bg-amber-700"
                />
              </div>
            </div>
            {file && srtFile && (
              <div className="flex items-center gap-3 text-sm text-zinc-400 bg-zinc-950/50 rounded-lg p-3">
                <svg className="h-5 w-5 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Vídeo: <strong className="text-zinc-200">{file.name}</strong></span>
                <span className="mx-2">+</span>
                <span>Legenda: <strong className="text-zinc-200">{srtFile.name}</strong></span>
              </div>
            )}
            <button
              type="submit"
              disabled={!file || !srtFile || isUploading || importingSrt}
              className={`w-full rounded-xl py-3.5 text-base font-bold tracking-wide transition-colors ${
                file && srtFile && !isUploading && !importingSrt
                  ? 'bg-amber-600 text-white hover:bg-amber-700'
                  : 'cursor-not-allowed bg-zinc-800 text-zinc-600'
              }`}
            >
              {importingSrt ? 'IMPORTANDO LEGENDA...' : 'IMPORTAR VÍDEO + LEGENDA'}
            </button>
          </form>
        </div>

        <div className="mt-8 flex items-center justify-center gap-6 text-xs text-zinc-600">
          <span>Transcrição com timestamps</span>
          <span className="text-zinc-800">•</span>
          <span>Ranking com IA</span>
          <span className="text-zinc-800">•</span>
          <span>Até 20 cortes</span>
        </div>
      </div>
    </div>
  );
}
