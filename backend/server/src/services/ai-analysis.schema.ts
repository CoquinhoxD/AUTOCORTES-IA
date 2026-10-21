import { z } from 'zod';

/**
 * Schema da resposta da IA.
 * A IA deve responder SOMENTE JSON válido — nada de Markdown.
 */
export const CutScoresSchema = z.object({
  retention: z.number().int().min(0).max(100),
  comments: z.number().int().min(0).max(100),
  shares: z.number().int().min(0).max(100),
  controversy: z.number().int().min(0).max(100),
  curiosity: z.number().int().min(0).max(100),
  emotion: z.number().int().min(0).max(100),
  replay: z.number().int().min(0).max(100),
  viralPotential: z.number().int().min(0).max(100),
});

/**
 * Scores achatados — é a forma que a rota e o Prisma persistem.
 */
export const FlatScoresSchema = z.object({
  retentionScore: z.number().int().min(0).max(100),
  commentsScore: z.number().int().min(0).max(100),
  sharesScore: z.number().int().min(0).max(100),
  controversyScore: z.number().int().min(0).max(100),
  curiosityScore: z.number().int().min(0).max(100),
  emotionScore: z.number().int().min(0).max(100),
  replayScore: z.number().int().min(0).max(100),
  viralPotential: z.number().int().min(0).max(100),
});

/**
 * Corte no formato que a IA devolve: `scores` aninhado (é o que o prompt
 * pede). O gerador local e a validação já produzem flat — por isso o schema
 * aceita as duas formas, com pelo menos uma obrigatória.
 */
export const AICutSchema = z
  .object({
    rank: z.number().int().min(1),
    theme: z.string().min(1),
    startTime: z.number().min(0),
    endTime: z.number().min(0),
    duration: z.number().min(0),
    subject: z.string().min(1),
    whyViral: z.string().min(1),
    hook: z.string().min(1),
    strongestMoment: z.string().min(1),
    conclusion: z.string().min(1),
    scores: CutScoresSchema.optional(),
    headline: z.string().min(1),
    alternativeHeadline: z.string().min(1),
  })
  .merge(FlatScoresSchema.partial())
  .refine(
    (cut) => Boolean(cut.scores) || cut.viralPotential !== undefined,
    'Informe scores aninhados ou os campos achatados.'
  );

export const AIAnalysisSchema = z.object({
  cuts: z.array(AICutSchema),
  controversies: z.array(z.string()).default([]),
  top5: z.array(z.number().int().min(1)).default([]),
});

export type AICut = z.infer<typeof AICutSchema>;
export type AIAnalysis = z.infer<typeof AIAnalysisSchema>;
export type CutScores = z.infer<typeof CutScoresSchema>;
export type FlatScores = z.infer<typeof FlatScoresSchema>;

/**
 * Normaliza um corte para a forma achatada que o resto do pipeline consome.
 * Aceita tanto `scores: { retention }` quanto `retentionScore`.
 */
export function flattenCutScores(cut: AICut): FlatScores {
  const source = cut.scores;

  return {
    retentionScore: cut.retentionScore ?? source?.retention ?? 0,
    commentsScore: cut.commentsScore ?? source?.comments ?? 0,
    sharesScore: cut.sharesScore ?? source?.shares ?? 0,
    controversyScore: cut.controversyScore ?? source?.controversy ?? 0,
    curiosityScore: cut.curiosityScore ?? source?.curiosity ?? 0,
    emotionScore: cut.emotionScore ?? source?.emotion ?? 0,
    replayScore: cut.replayScore ?? source?.replay ?? 0,
    viralPotential: cut.viralPotential ?? source?.viralPotential ?? 0,
  };
}