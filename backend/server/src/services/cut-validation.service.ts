import { z } from 'zod';

/**
 * Schema de um corte já validado e normalizado para persistência.
 */
export const VALIDATED_CUT_SCHEMA = z.object({
  rank: z.number().int().min(1).max(20),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  duration: z.number().min(0),
  theme: z.string().min(1),
  subject: z.string().min(1),
  whyViral: z.string().min(1),
  hook: z.string().min(1),
  strongestMoment: z.string().min(1),
  conclusion: z.string().min(1),
  retentionScore: z.number().int().min(0).max(100),
  commentsScore: z.number().int().min(0).max(100),
  sharesScore: z.number().int().min(0).max(100),
  controversyScore: z.number().int().min(0).max(100),
  curiosityScore: z.number().int().min(0).max(100),
  emotionScore: z.number().int().min(0).max(100),
  replayScore: z.number().int().min(0).max(100),
  viralPotential: z.number().int().min(0).max(100),
  headline: z.string().min(1),
  alternativeHeadline: z.string().min(1),
});

export const ValidatedCutSchema = VALIDATED_CUT_SCHEMA;
export type ValidatedCut = z.infer<typeof VALIDATED_CUT_SCHEMA>;
