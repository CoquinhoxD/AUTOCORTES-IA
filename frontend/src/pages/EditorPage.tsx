import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, videoStreamUrl } from '../services/api';
import type { Cut, Transcript } from '../types';
import { VideoClipPlayer } from '../components/VideoClipPlayer';
import { TranscriptViewer } from '../components/TranscriptViewer';
import { formatDuration, formatTimecode, formatFps, formatResolution } from '../utils/format';

type EditorTab = 'preview' | 'framing' | 'metadata';

const FRAMING_MODES = [
  { id: 'center', label: 'Centralizado', desc: 'Crop central simples (rápido)' },
  { id: 'blur', label: 'Fundo desfocado', desc: 'Vídeo original centralizado com blur nas laterais' },
  { id: 'face', label: 'Rastreamento de rosto', desc: 'Detecta e segue o rosto do falante (experimental)' },
] as const;


const SUBTITLE_STYLES = [
  { id: 'viral', label: 'Viral clássico', desc: 'Branco com contorno preto, estilo TikTok/Reels' },
  { id: 'word', label: 'Palavra destacada', desc: 'Uma palavra por vez, destaque animado' },
  { id: 'minimal', label: 'Minimalista', desc: 'Fino, sem sombra, discreto' },
  { id: 'gamer', label: 'Gamer', desc: 'Amarelo Impact, contorno grosso' },
  { id: 'podcast', label: 'Podcast', desc: 'Georgia serifada, margens maiores' },
] as const;

export function EditorPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();

  const [video, setVideo] = useState<{ originalName: string; duration: number; width: number; height: number; fps: number; streamUrl: string } | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>('preview');
  const [selectedCutIndex, setSelectedCutIndex] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [seekRequest, setSeekRequest] = useState<{ time: number; id: number } | null>(null);
  const [playerTime, setPlayerTime] = useState<number | null>(null);

  // Estado de edição do corte selecionado
  const [editState, setEditState] = useState<{
    startTime: number;
    endTime: number;
    theme: string;
    headline: string;
    alternativeHeadline: string;
    framingMode: 'center' | 'blur' | 'face';
    subtitleStyle: 'viral' | 'word' | 'minimal' | 'gamer' | 'podcast' | 'custom';
    addSubtitles: boolean;
  } | null>(null);

  const selectedCut = cuts[selectedCutIndex] ?? null;

  // Carregar dados do vídeo
  useEffect(() => {
    if (!videoId) return;

    let cancelled = false;

    async function loadData() {
      try {
        const [result, transcriptData] = await Promise.all([
          api.getResult(videoId!),
          api.getTranscript(videoId!).catch(() => null),
        ]);

        if (cancelled) return;

        setVideo({
          originalName: result.video.originalName,
          duration: result.video.duration,
          width: result.video.width,
          height: result.video.height,
          fps: result.video.fps,
          streamUrl: videoStreamUrl(videoId!),
        });
        setCuts(result.cuts);
        setTranscript(transcriptData);

        if (result.cuts.length > 0) {
          setSelectedCutIndex(0);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Falha ao carregar dados do editor.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();

    return () => { cancelled = true; };
  }, [videoId]);

  // Atualizar estado de edição quando o corte selecionado muda
  useEffect(() => {
    if (selectedCut) {
      setEditState({
        startTime: selectedCut.startTime,
        endTime: selectedCut.endTime,
        theme: selectedCut.theme,
        headline: selectedCut.headline,
        alternativeHeadline: selectedCut.alternativeHeadline,
        framingMode: 'blur',
        subtitleStyle: 'viral',
        addSubtitles: false,
      });
    }
  }, [selectedCut]);

  const handleSeek = useCallback((time: number) => {
    setSeekRequest((current) => ({ time, id: (current?.id ?? 0) + 1 }));
  }, []);

  const handleTimeUpdate = useCallback((time: number) => {
    setPlayerTime(time);
  }, []);

  const handleSelectCut = useCallback((index: number) => {
    setSelectedCutIndex(index);
    setSeekRequest(null);
  }, []);

  const handleDeleteCut = useCallback(async (index: number) => {
    if (!confirm('Excluir este corte?')) return;

    const newCuts = cuts.filter((_, i) => i !== index);
    setCuts(newCuts);

    if (selectedCutIndex >= newCuts.length) {
      setSelectedCutIndex(Math.max(0, newCuts.length - 1));
    }
  }, [cuts, selectedCutIndex]);

  const handleReorderCuts = useCallback((fromIndex: number, toIndex: number) => {
    const newCuts = [...cuts];
    const [removed] = newCuts.splice(fromIndex, 1);
    newCuts.splice(toIndex, 0, removed);
    // Reatribuir ranks
    newCuts.forEach((cut, i) => { cut.rank = i + 1; });
    setCuts(newCuts);
  }, [cuts]);

  const handleSaveCut = useCallback(async () => {
    if (!editState || !selectedCut) return;

    setSaving(true);
    try {
      // Atualizar o corte localmente
      const updatedCuts = [...cuts];
      updatedCuts[selectedCutIndex] = {
        ...updatedCuts[selectedCutIndex],
        startTime: editState.startTime,
        endTime: editState.endTime,
        duration: editState.endTime - editState.startTime,
        theme: editState.theme,
        headline: editState.headline,
        alternativeHeadline: editState.alternativeHeadline,
      };
      setCuts(updatedCuts);

      // TODO: Salvar no backend via API
      // await api.updateCut(videoId!, selectedCut.id, editState);

      setSaving(false);
      alert('Alterações salvas localmente. Use "Exportar" para gerar o vídeo final.');
    } catch (caught) {
      setSaving(false);
      alert(`Erro ao salvar: ${caught instanceof Error ? caught.message : 'Erro desconhecido'}`);
    }
  }, [editState, selectedCut, cuts, selectedCutIndex, videoId]);

  const handleExportCut = useCallback(async () => {
    if (!editState || !video) return;

    setSaving(true);
    try {
      const response = await api.exportCut(videoId!, {
        startTime: editState.startTime,
        endTime: editState.endTime,
        reencode: false,
        vertical: false,
        addSubtitles: editState.addSubtitles,
        subtitleStyle: editState.subtitleStyle,
      });

      setSaving(false);
      alert(`Corte exportado com sucesso!\n${response.filename}\n\nDisponível para download.`);
    } catch (caught) {
      setSaving(false);
      alert(`Erro ao exportar: ${caught instanceof Error ? caught.message : 'Erro desconhecido'}`);
    }
  }, [editState, video, videoId]);

  const handleExportAll = useCallback(async () => {
    if (!video || cuts.length === 0) return;

    if (!confirm(`Exportar ${cuts.length} cortes? Isso pode levar alguns minutos.`)) return;

    setSaving(true);
    try {
      const cutsToExport = cuts.map((cut, i) => ({
        rank: i + 1,
        startTime: cut.startTime,
        endTime: cut.endTime,
        reencode: false,
        vertical: false,
        addSubtitles: false,
        subtitleStyle: 'viral' as const,
      }));

      const response = await api.exportBatch(videoId!, { cuts: cutsToExport });

      setSaving(false);
      alert(`${response.total} cortes exportados com sucesso!\n${response.failed} falharam.\n\nVerifique a pasta de resultados.`);
    } catch (caught) {
      setSaving(false);
      alert(`Erro ao exportar em lote: ${caught instanceof Error ? caught.message : 'Erro desconhecido'}`);
    }
  }, [video, cuts, videoId]);

  if (!videoId) {
    return <div className="p-6 text-center text-zinc-400">ID do vídeo inválido.</div>;
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-zinc-950"><div className="animate-spin rounded-full h-12 w-12 border-4 border-purple-600 border-t-transparent" /></div>;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-6 max-w-md text-center">
          <p className="text-red-300">{error}</p>
          <button onClick={() => navigate('/history')} className="mt-4 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-700">
            Voltar ao histórico
          </button>
        </div>
      </div>
    );
  }

  if (!video || cuts.length === 0) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-zinc-400">Nenhum corte disponível para editar.</p>
          <button onClick={() => navigate('/history')} className="mt-4 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-700">
            Voltar ao histórico
          </button>
        </div>
      </div>
    );
  }

  const streamUrl = video.streamUrl;

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="mx-auto max-w-7xl px-6 py-6">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(`/analysis/${videoId}`)} className="text-zinc-500 hover:text-zinc-200">
              ← Voltar à análise
            </button>
            <div>
              <h1 className="text-xl font-bold text-zinc-50 truncate max-w-md">{video.originalName}</h1>
              <p className="text-sm text-zinc-500">
                {cuts.length} corte{cuts.length !== 1 ? 's' : ''} • {formatDuration(video.duration)} • {formatResolution(video.width, video.height)} @ {formatFps(video.fps)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={handleExportCut} disabled={saving || !editState} className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50">
              {saving ? 'Exportando...' : 'Exportar este corte'}
            </button>
            <button onClick={handleExportAll} disabled={saving} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
              Exportar todos ({cuts.length})
            </button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
          {/* Painel principal: Player + Tabs */}
          <div className="space-y-4">
            {/* Player */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
              <VideoClipPlayer
                videoUrl={streamUrl}
                startTime={editState?.startTime ?? selectedCut?.startTime ?? 0}
                endTime={editState?.endTime ?? selectedCut?.endTime ?? video.duration}
                showInfo={true}
                seekRequest={seekRequest}
                onTimeUpdate={handleTimeUpdate}
              />
            </div>

            {/* Tabs do Editor */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
              <div className="border-b border-zinc-800 flex gap-1 p-1">
                {[
                  { id: 'preview', label: '▶ Preview' },
                  { id: 'framing', label: '📐 Enquadramento' },
                  { id: 'metadata', label: '📋 Metadados' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id as EditorTab)}
                    className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-100'}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="p-4">
                {activeTab === 'preview' && <PreviewTab cut={selectedCut} editState={editState} setEditState={setEditState} onSeek={handleSeek} playerTime={playerTime} transcript={transcript} />}
                {activeTab === 'framing' && <FramingTab editState={editState} setEditState={setEditState} />}
                {activeTab === 'metadata' && <MetadataTab editState={editState} setEditState={setEditState} cut={selectedCut} />}
              </div>
            </div>
          </div>

          {/* Sidebar: Lista de cortes */}
          <aside className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-zinc-100">Cortes ({cuts.length})</h2>
                <span className="text-xs text-zinc-500">Arraste para reordenar</span>
              </div>

              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {cuts.map((cut, index) => (
                  <EditorCutItem
                    key={cut.id}
                    cut={cut}
                    index={index}
                    isSelected={index === selectedCutIndex}
                    onSelect={() => handleSelectCut(index)}
                    onDelete={() => handleDeleteCut(index)}
                    onMoveUp={() => index > 0 && handleReorderCuts(index, index - 1)}
                    onMoveDown={() => index < cuts.length - 1 && handleReorderCuts(index, index + 1)}
                  />
                ))}
              </div>

              {cuts.length === 0 && (
                <p className="text-center text-zinc-500 py-8">Nenhum corte. Volte à análise para gerar cortes.</p>
              )}
            </div>

            {/* Ações rápidas */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-2">
              <button onClick={handleSaveCut} disabled={saving || !editState} className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50">
                {saving ? 'Salvando...' : 'Salvar alterações do corte'}
              </button>
              <button onClick={handleExportCut} disabled={saving || !editState} className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                Exportar corte atual
              </button>
              <button onClick={handleExportAll} disabled={saving} className="w-full rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
                Exportar todos ({cuts.length})
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

// --- Componentes das Tabs ---

function PreviewTab({ cut, editState, setEditState, onSeek, playerTime, transcript }: any) {
  if (!cut || !editState) return <div className="text-zinc-500">Selecione um corte.</div>;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Início</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max={cut.endTime - 0.1}
            value={editState.startTime}
            onChange={(e) => setEditState({ ...editState, startTime: Number(e.target.value) })}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Fim</label>
          <input
            type="number"
            step="0.1"
            min={editState.startTime + 0.1}
            value={editState.endTime}
            onChange={(e) => setEditState({ ...editState, endTime: Number(e.target.value) })}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Duração</label>
          <input type="text" value={formatDuration(editState.endTime - editState.startTime)} readOnly className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-400" />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Tempo do player</label>
          <input type="text" value={playerTime != null ? formatTimecode(playerTime, true) : '--:--'} readOnly className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-400" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => onSeek(editState.startTime)} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800">Ir para início</button>
        <button onClick={() => onSeek(editState.endTime)} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800">Ir para fim</button>
        <button onClick={() => onSeek(Math.max(0, editState.startTime - 5))} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800">-5s</button>
        <button onClick={() => onSeek(Math.min(editState.endTime, editState.startTime + 5))} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800">+5s</button>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">Transcrição do trecho</h3>
        <TranscriptViewer segments={transcript?.segments ?? []} onSeek={onSeek} activeTime={editState.startTime} />
      </div>
    </div>
  );
}

function SubtitlesTab({ editState, setEditState, transcript, onSeek }: any) {
  if (!editState) return <div className="text-zinc-500">Selecione um corte.</div>;

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={editState.addSubtitles} onChange={(e) => setEditState({ ...editState, addSubtitles: e.target.checked })} className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 accent-purple-600" />
        <span className="text-zinc-100">Adicionar legendas ao exportar</span>
      </label>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">Estilo da legenda</label>
        <div className="grid gap-2 sm:grid-cols-2">
          {SUBTITLE_STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              onClick={() => setEditState({ ...editState, subtitleStyle: style.id as any })}
              className={`rounded-lg border-2 p-3 text-left transition-colors ${editState.subtitleStyle === style.id ? 'border-purple-500 bg-purple-950/30' : 'border-zinc-800 hover:border-zinc-700'}`}
            >
              <p className="font-medium text-zinc-100">{style.label}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{style.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {editState.addSubtitles && transcript && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 max-h-96 overflow-y-auto">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">Prévia das legendas (segmentos no intervalo)</h3>
          <TranscriptViewer segments={transcript.segments} onSeek={onSeek} activeTime={editState.startTime} />
        </div>
      )}
    </div>
  );
}

function FramingTab({ editState, setEditState }: any) {
  if (!editState) return <div className="text-zinc-500">Selecione um corte.</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400">Escolha como converter o vídeo horizontal para vertical 9:16.</p>

      <div className="space-y-2">
        {FRAMING_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => setEditState({ ...editState, framingMode: mode.id })}
            className={`w-full rounded-lg border-2 p-3 text-left transition-colors ${editState.framingMode === mode.id ? 'border-purple-500 bg-purple-950/30' : 'border-zinc-800 hover:border-zinc-700'}`}
          >
            <p className="font-medium text-zinc-100">{mode.label}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{mode.desc}</p>
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
        <p><strong>Nota:</strong> O modo "Rastreamento de rosto" usa detecção básica. Para melhores resultados, use "Fundo desfocado" que mantém o vídeo original centralizado com blur nas laterais.</p>
      </div>
    </div>
  );
}

function MetadataTab({ editState, setEditState, cut }: any) {
  if (!editState || !cut) return <div className="text-zinc-500">Selecione um corte.</div>;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Tema / Título do corte</label>
        <input
          type="text"
          value={editState.theme}
          onChange={(e) => setEditState({ ...editState, theme: e.target.value })}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Headline principal</label>
        <input
          type="text"
          value={editState.headline}
          onChange={(e) => setEditState({ ...editState, headline: e.target.value })}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Headline alternativa</label>
        <input
          type="text"
          value={editState.alternativeHeadline}
          onChange={(e) => setEditState({ ...editState, alternativeHeadline: e.target.value })}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500"
        />
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">Scores originais (IA)</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {[
            { key: 'viralPotential', label: 'Potencial Viral' },
            { key: 'retentionScore', label: 'Retenção' },
            { key: 'curiosityScore', label: 'Curiosidade' },
            { key: 'emotionScore', label: 'Emoção' },
            { key: 'controversyScore', label: 'Polêmica' },
            { key: 'commentsScore', label: 'Comentários' },
            { key: 'sharesScore', label: 'Compartilhamentos' },
            { key: 'replayScore', label: 'Replay' },
          ].map((s) => (
            <div key={s.key} className="flex justify-between">
              <span className="text-zinc-400">{s.label}</span>
              <span className="font-mono font-bold text-zinc-100">{cut[s.key as keyof typeof cut]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EditorCutItem({ cut, index, isSelected, onSelect, onDelete, onMoveUp, onMoveDown }: any) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${isSelected ? 'bg-purple-950/50 border border-purple-800' : 'border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50'}`}
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded font-bold text-white ${isSelected ? 'bg-purple-600' : 'bg-zinc-700'}`}>
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-zinc-100">{cut.theme}</p>
        <p className="truncate text-xs text-zinc-500">{formatTimecode(cut.startTime, true)} → {formatTimecode(cut.endTime, true)} • {cut.duration.toFixed(1)}s</p>
      </div>
      <span className="font-mono text-lg font-bold text-purple-400">{cut.viralPotential}</span>
      <div className="flex items-center gap-1">
        <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} className="p-1.5 rounded text-zinc-500 hover:text-zinc-200" title="Mover para cima">↑</button>
        <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} className="p-1.5 rounded text-zinc-500 hover:text-zinc-200" title="Mover para baixo">↓</button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 rounded text-zinc-500 hover:text-red-400" title="Excluir">✕</button>
      </div>
    </button>
  );
}

// Adicionar métodos à API
declare module '../services/api' {
  interface Api {
    exportCut(videoId: string, options: any): Promise<any>;
    exportBatch(videoId: string, options: { cuts: any[] }): Promise<any>;
    updateCut(videoId: string, cutId: string, data: any): Promise<any>;
  }
}