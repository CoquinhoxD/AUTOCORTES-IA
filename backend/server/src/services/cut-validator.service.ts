import type { TranscriptSegment } from './transcription.service.js';
import type { AICut } from './ai-analysis.schema.js';
import { flattenCutScores } from './ai-analysis.schema.js';
import { VALIDATED_CUT_SCHEMA, type ValidatedCut } from './cut-validation.service.js';

export interface CutValidationContext {
  /** Duração real do vídeo em segundos (vinda do ffprobe). */
  videoDuration: number;
  /** Segmentos da transcrição normalizada, para validar se o timestamp existe. */
  segments: TranscriptSegment[];
  /** Quantidade máxima de cortes. Padrão 20. */
  maxCuts?: number;
  /** Limiar de sobreposição para descartar duplicados (0.0 a 1.0). Padrão 0.6. */
  overlapThreshold?: number;
  /** Duração mínima de um corte em segundos. Padrão 5. */
  minCutDuration?: number;
  /** Duração máxima de um corte em segundos. Padrão 180. */
  maxCutDuration?: number;
}

export interface CutValidationReport {
  cuts: ValidatedCut[];
  rejected: RejectedCut[];
  /** true quando a IA tentou devolver exatamente maxCuts cortes. */
  reachedTarget: boolean;
  /** Mensagem clara quando o conteúdo não tem material para maxCuts cortes. */
  notice?: string;
}

export interface RejectedCut {
  rank: number;
  theme: string;
  reason: string;
}

export const MIN_CUT_DURATION = 5;
export const MAX_CUT_DURATION = 180;
/** Tolerância em segundos para casar timestamps com segmentos da transcrição. */
const TIMESTAMP_MATCH_TOLERANCE = 1.5;

export function computeDuration(startTime: number, endTime: number): number {
  return Number((endTime - startTime).toFixed(3));
}

/**
 * Verifica se um timestamp corresponde a um segmento real da transcrição.
 * A IA não pode inventar timestamps.
 */
export function timestampMatchesSegment(
  timestamp: number,
  segments: TranscriptSegment[],
  tolerance: number = TIMESTAMP_MATCH_TOLERANCE
): boolean {
  return segments.some(
    (seg) => timestamp >= seg.start - tolerance && timestamp <= seg.end + tolerance
  );
}

/** Expande limites apenas para as bordas reais dos segmentos, sem cortar falas no meio. */
export function alignCutToSpeech(
  start: number, end: number, segments: TranscriptSegment[], maxDuration: number
): { start: number; end: number } | null {
  if (!segments.length) return { start, end };
  const ordered = [...segments].filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start).sort((a,b) => a.start - b.start);
  const first = ordered.find(s => s.end > start && s.start <= start + 1.5);
  const last = [...ordered].reverse().find(s => s.start < end && s.end >= end - 1.5);
  if (!first || !last) return null;
  let adjustedStart = Math.min(start, first.start);
  let adjustedEnd = Math.max(end, last.end);
  // Inclui uma pergunta imediatamente anterior quando o corte começa com uma resposta curta.
  const firstIndex = ordered.indexOf(first);
  if (firstIndex > 0) {
    const previous = ordered[firstIndex - 1];
    const gap = first.start - previous.end;
    if (gap >= 0 && gap <= 1.5 && /\\?\\s*$/.test(previous.text) &&
        adjustedEnd - previous.start <= maxDuration) {
      adjustedStart = previous.start;
    }
  }
  if (adjustedEnd - adjustedStart > maxDuration) return null;
  return { start: Math.max(0, adjustedStart), end: adjustedEnd };
}

/**
 * Valida a lista de cortes retornada pela IA.
 *
 * Regras aplicadas (requisito 29 — segurança contra alucinação):
 * - startTime >= 0
 * - endTime > startTime
 * - endTime <= duração do vídeo
 * - duration = endTime - startTime (recalculado, nunca aceito da IA)
 * - startTime e endTime devem corresponder a segmentos existentes
 * - remove duplicados e candidatos sobrepostos
 * - ordena por viralPotential e limita a maxCuts
 */
export function validateCuts(
  cuts: AICut[],
  context: CutValidationContext
): CutValidationReport {
  const maxCuts = context.maxCuts ?? 20;
  const minCutDuration = context.minCutDuration ?? MIN_CUT_DURATION;
  const maxCutDuration = context.maxCutDuration ?? MAX_CUT_DURATION;
  const overlapThreshold = context.overlapThreshold ?? 0.6;
  const { videoDuration, segments } = context;
  const rejected: RejectedCut[] = [];
  const accepted: Array<{ cut: AICut; start: number; end: number }> = [];

  const isRealVideo = videoDuration > 0;

  for (const cut of cuts) {
    let start = Number(cut.startTime);
    let end = Number(cut.endTime);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      rejected.push({ rank: cut.rank, theme: cut.theme, reason: 'Timestamps inválidos (NaN/Infinity)' });
      continue;
    }

    if (start < 0) {
      rejected.push({ rank: cut.rank, theme: cut.theme, reason: `startTime negativo (${start})` });
      continue;
    }

    if (end <= start) {
      rejected.push({ rank: cut.rank, theme: cut.theme, reason: `endTime (${end}) <= startTime (${start})` });
      continue;
    }

    if (isRealVideo && end > videoDuration) {
      rejected.push({
        rank: cut.rank,
        theme: cut.theme,
        reason: `endTime (${end}s) excede duração do vídeo (${videoDuration}s)`,
      });
      continue;
    }

    if (segments.length > 0) {
      if (!timestampMatchesSegment(start, segments)) {
        rejected.push({
          rank: cut.rank,
          theme: cut.theme,
          reason: `startTime (${start}s) não corresponde a nenhum segmento da transcrição`,
        });
        continue;
      }
      if (!timestampMatchesSegment(end, segments)) {
        rejected.push({
          rank: cut.rank,
          theme: cut.theme,
          reason: `endTime (${end}s) não corresponde a nenhum segmento da transcrição`,
        });
        continue;
      }
    }

    if (segments.length > 0) {
      const aligned = alignCutToSpeech(start, end, segments, maxCutDuration);
      if (!aligned || (isRealVideo && aligned.end > videoDuration)) {
        rejected.push({ rank: cut.rank, theme: cut.theme, reason: 'Não foi possível preservar as falas completas dentro da duração permitida' });
        continue;
      }
      start = aligned.start;
      end = aligned.end;
    }

    const duration = end - start;
    if (duration < minCutDuration) {
      rejected.push({
        rank: cut.rank,
        theme: cut.theme,
        reason: `duração muito curta (${duration.toFixed(1)}s < ${minCutDuration}s)`,
      });
      continue;
    }

    if (duration > maxCutDuration) {
      rejected.push({
        rank: cut.rank,
        theme: cut.theme,
        reason: `duração muito longa (${duration.toFixed(1)}s > ${maxCutDuration}s)`,
      });
      continue;
    }

    accepted.push({ cut, start, end });
  }

  // ordena por potencial viral (desempate: retenção)
  accepted.sort((a, b) => {
    const aScores = flattenCutScores(a.cut);
    const bScores = flattenCutScores(b.cut);
    const diff = bScores.viralPotential - aScores.viralPotential;
    return diff !== 0 ? diff : bScores.retentionScore - aScores.retentionScore;
  });

  // remove sobreposição: dois cortes com mais de N% de interseção são duplicados
  const nonOverlapping: typeof accepted = [];
  for (const candidate of accepted) {
    const overlaps = nonOverlapping.some((existing) => {
      const overlapStart = Math.max(candidate.start, existing.start);
      const overlapEnd = Math.min(candidate.end, existing.end);
      const overlap = Math.max(0, overlapEnd - overlapStart);
      const shorter = Math.min(candidate.end - candidate.start, existing.end - existing.start);
      return shorter > 0 && overlap / shorter > overlapThreshold;
    });

    if (overlaps) {
      rejected.push({
        rank: candidate.cut.rank,
        theme: candidate.cut.theme,
        reason: 'Corte duplicado ou sobreposto a um corte de maior potencial',
      });
      continue;
    }

    nonOverlapping.push(candidate);
  }

  // limita ao máximo e reatribui ranks globais
  const finalCuts = nonOverlapping.slice(0, maxCuts).map(({ cut, start, end }, index) => ({
    rank: index + 1,
    startTime: start,
    endTime: end,
    duration: computeDuration(start, end),
    theme: cut.theme,
    subject: cut.subject,
    whyViral: cut.whyViral,
    hook: cut.hook,
    strongestMoment: cut.strongestMoment,
    conclusion: cut.conclusion,
    // Normaliza aninhado (`scores`) ou flat para a mesma forma achatada.
    ...flattenCutScores(cut),
    headline: cut.headline,
    alternativeHeadline: cut.alternativeHeadline,
  }));

  // validação final com Zod — nunca salva JSON inválido no banco
  const validation = VALIDATED_CUT_SCHEMA.array().safeParse(finalCuts);
  if (!validation.success) {
    throw new Error(
      `Cortes inválidos após validação: ${validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`
    );
  }

  const reachedTarget = validation.data.length === maxCuts;
  const notice = reachedTarget
    ? undefined
    : `O conteúdo não possui ${maxCuts} candidatos válidos e distintos. Foram encontrados ${validation.data.length} corte(s) aproveitável(is).`;

  return { cuts: validation.data, rejected, reachedTarget, notice };
}
