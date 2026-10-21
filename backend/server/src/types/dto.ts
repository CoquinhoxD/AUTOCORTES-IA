import { z } from 'zod';
import { VALIDATED_CUT_SCHEMA } from '../services/cut-validation.service.js';

export const TranscriptSegmentSchema = z.object({
  id: z.number().int().min(0),
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string().min(1),
});

export const TranscriptSchema = z.object({
  fullText: z.string(),
  segments: z.array(TranscriptSegmentSchema),
});

export const JobStatusResponseSchema = z.object({
  status: z.string(),
  progress: z.number().min(0).max(100),
  message: z.string(),
});

export const VideoResponseSchema = z.object({
  id: z.string(),
  originalName: z.string(),
  duration: z.number(),
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  status: z.string(),
  createdAt: z.string(),
});

export const AnalysisResultSchema = z.object({
  video: VideoResponseSchema.partial(),
  cuts: z.array(VALIDATED_CUT_SCHEMA),
  controversies: z.array(z.string()),
  top5: z.array(z.number().int()),
});

export type TranscriptSegmentDto = z.infer<typeof TranscriptSegmentSchema>;
export type JobStatusDto = z.infer<typeof JobStatusResponseSchema>;
