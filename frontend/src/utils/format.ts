/**
 * Formatação de tempo e utilitários de apresentação.
 * Espelha as regras do backend para evitar divergência na UI.
 */

/** 0 → "00:00" | 95 → "01:35" | 3661 → "01:01:01" */
export function formatTimecode(seconds: number, forceHours = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';

  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const mm = mins.toString().padStart(2, '0');
  const ss = secs.toString().padStart(2, '0');

  if (hrs > 0 || forceHours) {
    return `${hrs.toString().padStart(2, '0')}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/** Duração legível: "1min 35s" | "45s" */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0s';

  if (seconds < 60) return `${Math.round(seconds)}s`;

  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);

  if (mins < 60) return secs > 0 ? `${mins}min ${secs}s` : `${mins}min`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/** Duração curta para cards: "39,6s" */
export function formatDurationShort(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  return `${seconds.toFixed(1).replace('.', ',')}s`;
}

/** Tamanho de arquivo: "1,2 GB" | "340 MB" | "12 KB" */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(exponent === 0 ? 0 : 1).replace('.', ',')} ${units[exponent]}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function scoreTone(score: number): 'high' | 'medium' | 'low' {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

export function formatResolution(width: number, height: number): string {
  if (!width || !height) return '—';
  return `${width}×${height}`;
}

export function formatFps(fps: number): string {
  if (!Number.isFinite(fps) || fps <= 0) return '—';
  return `${Number.isInteger(fps) ? fps : fps.toFixed(2).replace('.', ',')} fps`;
}
