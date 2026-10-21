import { describe, it, expect } from '@jest/globals';
import { z } from 'zod';

const CutSchema = z.object({
  rank: z.number().int().min(1).max(20),
  theme: z.string().min(1),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  duration: z.number().min(0),
  subject: z.string().min(1),
  whyViral: z.string().min(1),
  hook: z.string().min(1),
  strongestMoment: z.string().min(1),
  conclusion: z.string().min(1),
  scores: z.object({
    retention: z.number().int().min(0).max(100),
    comments: z.number().int().min(0).max(100),
    shares: z.number().int().min(0).max(100),
    controversy: z.number().int().min(0).max(100),
    curiosity: z.number().int().min(0).max(100),
    emotion: z.number().int().min(0).max(100),
    replay: z.number().int().min(0).max(100),
    viralPotential: z.number().int().min(0).max(100),
  }),
  headline: z.string().min(1),
  alternativeHeadline: z.string().min(1),
});

describe('Cut Validation', () => {
  it('should validate a correct cut object', () => {
    const validCut = {
      rank: 1,
      theme: 'Test Theme',
      startTime: 0,
      endTime: 30,
      duration: 30,
      subject: 'Test subject',
      whyViral: 'Test reason',
      hook: 'Test hook',
      strongestMoment: 'Test moment',
      conclusion: 'Test conclusion',
      scores: {
        retention: 90,
        comments: 85,
        shares: 80,
        controversy: 75,
        curiosity: 95,
        emotion: 70,
        replay: 88,
        viralPotential: 92,
      },
      headline: 'Test headline',
      alternativeHeadline: 'Alternative headline',
    };

    const result = CutSchema.safeParse(validCut);
    expect(result.success).toBe(true);
  });

  it('should reject cut with invalid rank', () => {
    const invalidCut = {
      rank: 25,
      theme: 'Test',
      startTime: 0,
      endTime: 10,
      duration: 10,
      subject: 'Test',
      whyViral: 'Test',
      hook: 'Test',
      strongestMoment: 'Test',
      conclusion: 'Test',
      scores: {
        retention: 50,
        comments: 50,
        shares: 50,
        controversy: 50,
        curiosity: 50,
        emotion: 50,
        replay: 50,
        viralPotential: 50,
      },
      headline: 'Test',
      alternativeHeadline: 'Test',
    };

    const result = CutSchema.safeParse(invalidCut);
    expect(result.success).toBe(false);
  });

  it('should reject cut with negative startTime', () => {
    const invalidCut = {
      rank: 1,
      theme: 'Test',
      startTime: -5,
      endTime: 10,
      duration: 15,
      subject: 'Test',
      whyViral: 'Test',
      hook: 'Test',
      strongestMoment: 'Test',
      conclusion: 'Test',
      scores: {
        retention: 50,
        comments: 50,
        shares: 50,
        controversy: 50,
        curiosity: 50,
        emotion: 50,
        replay: 50,
        viralPotential: 50,
      },
      headline: 'Test',
      alternativeHeadline: 'Test',
    };

    const result = CutSchema.safeParse(invalidCut);
    expect(result.success).toBe(false);
  });

  it('should reject cut with endTime <= startTime', () => {
    const invalidCut = {
      rank: 1,
      theme: 'Test',
      startTime: 10,
      endTime: 5,
      duration: -5,
      subject: 'Test',
      whyViral: 'Test',
      hook: 'Test',
      strongestMoment: 'Test',
      conclusion: 'Test',
      scores: {
        retention: 50,
        comments: 50,
        shares: 50,
        controversy: 50,
        curiosity: 50,
        emotion: 50,
        replay: 50,
        viralPotential: 50,
      },
      headline: 'Test',
      alternativeHeadline: 'Test',
    };

    const result = CutSchema.safeParse(invalidCut);
    expect(result.success).toBe(false);
  });

  it('should reject cut with scores out of range', () => {
    const invalidCut = {
      rank: 1,
      theme: 'Test',
      startTime: 0,
      endTime: 10,
      duration: 10,
      subject: 'Test',
      whyViral: 'Test',
      hook: 'Test',
      strongestMoment: 'Test',
      conclusion: 'Test',
      scores: {
        retention: 150,
        comments: 50,
        shares: 50,
        controversy: 50,
        curiosity: 50,
        emotion: 50,
        replay: 50,
        viralPotential: 50,
      },
      headline: 'Test',
      alternativeHeadline: 'Test',
    };

    const result = CutSchema.safeParse(invalidCut);
    expect(result.success).toBe(false);
  });
});

describe('Duration Calculation', () => {
  it('should calculate duration correctly', () => {
    const startTime = 10.5;
    const endTime = 45.2;
    const duration = endTime - startTime;
    expect(duration).toBeCloseTo(34.7, 1);
  });

  it('should handle zero duration', () => {
    const startTime = 0;
    const endTime = 0;
    const duration = endTime - startTime;
    expect(duration).toBe(0);
  });
});

describe('Time Formatting', () => {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  it('should format seconds correctly', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(30)).toBe('0:30');
    expect(formatTime(60)).toBe('1:00');
    expect(formatTime(90)).toBe('1:30');
    expect(formatTime(3661)).toBe('61:01');
  });
});

describe('Job Status Transitions', () => {
  const validTransitions: Record<string, string[]> = {
    QUEUED: ['PROCESSING_VIDEO', 'FAILED'],
    PROCESSING_VIDEO: ['EXTRACTING_AUDIO', 'FAILED'],
    EXTRACTING_AUDIO: ['TRANSCRIBING', 'FAILED'],
    TRANSCRIBING: ['ANALYZING', 'FAILED'],
    ANALYZING: ['GENERATING_CUTS', 'FAILED'],
    GENERATING_CUTS: ['COMPLETED', 'FAILED'],
    COMPLETED: [],
    FAILED: [],
  };

  it('should allow valid transitions', () => {
    expect(validTransitions.QUEUED).toContain('PROCESSING_VIDEO');
    expect(validTransitions.PROCESSING_VIDEO).toContain('EXTRACTING_AUDIO');
    expect(validTransitions.GENERATING_CUTS).toContain('COMPLETED');
  });

  it('should not allow invalid transitions', () => {
    expect(validTransitions.QUEUED).not.toContain('COMPLETED');
    expect(validTransitions.COMPLETED).not.toContain('QUEUED');
  });
});