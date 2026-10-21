import type { TranscriptSegment } from './transcription.service.js';

export interface TranscriptNormalizationResult {
  segments: TranscriptSegment[];
  fullText: string;
  /** Métricas de detecção de falhas na transcrição. */
  diagnostics: TranscriptionDiagnostics;
}

export interface TranscriptionDiagnostics {
  totalSegments: number;
  removedEmptySegments: number;
  isChronological: boolean;
  nonMonotonicPairs: number;
  totalDurationSeconds: number;
  wordsPerMinute: number;
  suspicious: boolean;
  warnings: string[];
}

const MIN_SEGMENT_LENGTH = 1; // caracteres
const MIN_SEGMENT_DURATION = 0.05; // segundos

/**
 * Normaliza a transcrição:
 * - remove segmentos vazios ou sem texto útil
 * - normaliza espaços (colapsa whitespace, remove espaços nas bordas)
 * - preserva pontuação
 * - mantém ordem cronológica
 * - recalcula duration e fullText
 * - detecta possíveis falhas de transcrição
 */
export function normalizeTranscription(
  rawSegments: TranscriptSegment[]
): TranscriptNormalizationResult {
  const warnings: string[] = [];

  const cleaned = rawSegments
    // remove segmentos vazios / whitespace-only / sem duração mínima
    .filter((seg) => {
      const text = typeof seg.text === 'string' ? seg.text.trim() : '';
      if (text.length < MIN_SEGMENT_LENGTH) return false;
      if (!(seg.end > seg.start)) return false;
      if (seg.end - seg.start < MIN_SEGMENT_DURATION) return false;
      return true;
    })
    // normaliza espaços preservando pontuação e quebras de linha intencionais
    .map((seg) => ({
      ...seg,
      start: Math.max(0, Number(seg.start.toFixed(3))),
      end: Number(Math.max(seg.start, seg.end).toFixed(3)),
      text: seg.text.replace(/[ \t]+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim(),
    }));

  const removedEmpty = rawSegments.length - cleaned.length;
  if (removedEmpty > 0) {
    warnings.push(`${removedEmpty} segmento(s) vazio(s) removido(s)`);
  }

  // verifica ordenação cronológica
  let nonMonotonicPairs = 0;
  for (let i = 1; i < cleaned.length; i++) {
    if (cleaned[i].start < cleaned[i - 1].start - 0.01) {
      nonMonotonicPairs++;
    }
  }

  // ordena cronologicamente e preserva essa ordem
  const isChronological = nonMonotonicPairs === 0;
  if (!isChronological) {
    warnings.push(`${nonMonotonicPairs} par(es) fora de ordem cronológica — reordenado`);
  }

  cleaned.sort((a, b) => a.start - b.start || a.end - b.end);

  // reindexa ids de forma sequencial
  cleaned.forEach((seg, index) => {
    seg.id = index;
  });

  const fullText = cleaned.map((seg) => seg.text).join(' ').trim();

  const totalDurationSeconds = cleaned.length
    ? Number((cleaned[cleaned.length - 1].end - cleaned[0].start).toFixed(3))
    : 0;

  const wordCount = fullText ? fullText.split(/\s+/).filter(Boolean).length : 0;
  const wordsPerMinute =
    totalDurationSeconds > 0 ? Number(((wordCount / totalDurationSeconds) * 60).toFixed(1)) : 0;

  // detecção de falhas: transcrição vazia ou velocidade de fala implausível
  const suspicious: string[] = [];
  if (cleaned.length === 0) warnings.push('TRANSCRIÇÃO VAZIA — nenhum segmento válido');
  if (wordsPerMinute > 400) {
    warnings.push(`${wordsPerMinute} palavras/min — possível transcrição corrompida`);
  }
  if (wordsPerMinute > 0 && wordsPerMinute < 25) {
    warnings.push(`${wordsPerMinute} palavras/min — possível falha de transcrição`);
  }
  if (totalDurationSeconds < 5 && cleaned.length > 0) {
    warnings.push('Áudio muito curto (<5s) — pode indicar extração incorreta');
  }
  if (wordsPerMinute === 0) suspicious.push('zero_palavras');

  return {
    segments: cleaned,
    fullText,
    diagnostics: {
      totalSegments: cleaned.length,
      removedEmptySegments: removedEmpty,
      isChronological,
      nonMonotonicPairs,
      totalDurationSeconds,
      wordsPerMinute,
      suspicious: suspicious.length > 0,
      warnings,
    },
  };
}
