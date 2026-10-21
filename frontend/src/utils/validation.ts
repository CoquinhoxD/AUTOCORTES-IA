import { formatBytes } from './format';

export const ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.mkv'] as const;

export const ALLOWED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/x-m4v',
  'video/mpeg',
] as const;

export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

export function getFileExtension(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index === -1 ? '' : filename.slice(index).toLowerCase();
}

export function validateVideoFile(file: File | null, maxSizeMb: number): FileValidationResult {
  if (!file) {
    return { valid: false, error: 'Selecione um vídeo para analisar.' };
  }

  const extension = getFileExtension(file.name);

  if (!(ALLOWED_VIDEO_EXTENSIONS as readonly string[]).includes(extension)) {
    return {
      valid: false,
      error: `Formato não suportado. Use: ${ALLOWED_VIDEO_EXTENSIONS.join(', ')}`,
    };
  }

  if (file.type && !(ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { valid: false, error: `Tipo de arquivo não suportado: ${file.type}` };
  }

  const maxBytes = maxSizeMb * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      valid: false,
      error: `Arquivo excede o limite de ${formatBytes(maxBytes)}.`,
    };
  }

  return { valid: true };
}
