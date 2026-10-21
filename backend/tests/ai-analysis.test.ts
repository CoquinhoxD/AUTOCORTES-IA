import { describe, it, expect, afterEach } from '@jest/globals';
import { AIAnalysisSchema } from '../server/src/services/ai-analysis.schema.js';
import {
  extractJson,
  setAiProvider,
  analyzeWithAi,
  AiAnalysisError,
} from '../server/src/services/ai-analysis.service.js';

function validCut(overrides: Record<string, unknown> = {}) {
  return {
    rank: 1,
    theme: 'Tema',
    startTime: 0,
    endTime: 30,
    duration: 30,
    subject: 'Assunto',
    whyViral: 'Motivo',
    hook: 'Gancho',
    strongestMoment: 'Momento',
    conclusion: 'Conclusão',
    scores: {
      retention: 90,
      comments: 88,
      shares: 85,
      controversy: 80,
      curiosity: 92,
      emotion: 78,
      replay: 86,
      viralPotential: 91,
    },
    headline: 'Headline',
    alternativeHeadline: 'Alternativa',
    ...overrides,
  };
}

afterEach(() => {
  setAiProvider(null);
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  delete process.env.AI_PROVIDER;
});

describe('extractJson', () => {
  it('extrai JSON puro sem cercas', () => {
    expect(extractJson('{"cuts":[]}')).toBe('{"cuts":[]}');
  });

  it('remove cerca de código json', () => {
    const raw = '```json\n{"cuts":[]}\n```';
    expect(extractJson(raw)).toBe('{"cuts":[]}');
  });

  it('remove cerca de código sem linguagem', () => {
    const raw = '```\n{"cuts":[]}\n```';
    expect(extractJson(raw)).toBe('{"cuts":[]}');
  });

  it('extrai JSON de texto com前后缀', () => {
    const raw = 'Aqui está o resultado: {"cuts":[]} espero que ajude';
    expect(extractJson(raw)).toBe('{"cuts":[]}');
  });

  it('lança erro quando não há JSON', () => {
    expect(() => extractJson('não há json aqui')).toThrow(/Nenhum objeto JSON/);
  });

  it('lança erro para chaves desbalanceadas', () => {
    expect(() => extractJson('{"cuts":[')).toThrow();
  });
});

describe('AIAnalysisSchema (validação com Zod)', () => {
  it('aceita resposta válida', () => {
    const result = AIAnalysisSchema.safeParse({ cuts: [validCut()], controversies: [], top5: [1] });
    expect(result.success).toBe(true);
  });

  it('rejeita corte sem headline', () => {
    const cut = validCut();
    delete (cut as Record<string, unknown>).headline;
    const result = AIAnalysisSchema.safeParse({ cuts: [cut] });
    expect(result.success).toBe(false);
  });

  it('rejeita score acima de 100', () => {
    const result = AIAnalysisSchema.safeParse({
      cuts: [
        validCut({
          scores: { retention: 150, comments: 50, shares: 50, controversy: 50, curiosity: 50, emotion: 50, replay: 50, viralPotential: 50 },
        }),
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita score abaixo de 0', () => {
    const result = AIAnalysisSchema.safeParse({
      cuts: [
        validCut({
          scores: { retention: -10, comments: 50, shares: 50, controversy: 50, curiosity: 50, emotion: 50, replay: 50, viralPotential: 50 },
        }),
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita score não-inteiro', () => {
    const result = AIAnalysisSchema.safeParse({
      cuts: [
        validCut({
          scores: { retention: 90.5, comments: 50, shares: 50, controversy: 50, curiosity: 50, emotion: 50, replay: 50, viralPotential: 50 },
        }),
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita startTime negativo', () => {
    const result = AIAnalysisSchema.safeParse({ cuts: [validCut({ startTime: -1 })] });
    expect(result.success).toBe(false);
  });

  it('aplica defaults para controversies e top5 ausentes', () => {
    const result = AIAnalysisSchema.safeParse({ cuts: [validCut()] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.controversies).toEqual([]);
      expect(result.data.top5).toEqual([]);
    }
  });

  it('aceita array vazio quando o conteúdo não tem material suficiente', () => {
    // Regra: nunca inventar cortes. Array vazio é válido — o pipeline
    // gera o aviso "conteúdo não possui 20 candidatos válidos".
    const result = AIAnalysisSchema.safeParse({ cuts: [] });
    expect(result.success).toBe(true);
  });
});

describe('analyzeWithAi', () => {
  const options = {
    fullText: 'texto completo',
    segments: [{ id: 0, start: 0, end: 10, text: 'texto' }],
    videoDuration: 100,
  };

  it('usa o gerador local quando não há API key configurada', async () => {
    const analysis = await analyzeWithAi(options);

    expect(analysis.cuts.length).toBeGreaterThan(0);
    expect(analysis.cuts[0].startTime).toBeGreaterThanOrEqual(0);
    expect(analysis.cuts[0].endTime).toBeLessThanOrEqual(options.videoDuration);
    expect(analysis.top5).toEqual(analysis.cuts.slice(0, 5).map((cut) => cut.rank));
  });

  it('retorna análise válida quando a IA responde JSON correto', async () => {
    process.env.AI_API_KEY = 'chave-de-teste-suficientemente-longa';
    process.env.AI_PROVIDER = 'groq';

    setAiProvider({
      async call() {
        return JSON.stringify({ cuts: [validCut()] });
      },
    });

    const result = await analyzeWithAi(options);
    expect(result.cuts).toHaveLength(1);
    expect(result.cuts[0].theme).toBe('Tema');
  });

  it('corrige JSON inválido na segunda chamada', async () => {
    process.env.AI_API_KEY = 'chave-de-teste-suficientemente-longa';
    process.env.AI_PROVIDER = 'groq';

    let callCount = 0;
    setAiProvider({
      async call() {
        callCount++;
        if (callCount === 1) return 'isto não é json';
        return JSON.stringify({ cuts: [validCut()] });
      },
    });

    const result = await analyzeWithAi(options);
    expect(callCount).toBe(2);
    expect(result.cuts).toHaveLength(1);
  });

  it('lança erro quando as duas tentativas falham', async () => {
    process.env.AI_API_KEY = 'chave-de-teste-suficientemente-longa';
    process.env.AI_PROVIDER = 'groq';

    let callCount = 0;
    setAiProvider({
      async call() {
        callCount++;
        return 'resposta inválida';
      },
    });

    await expect(analyzeWithAi(options)).rejects.toThrow(AiAnalysisError);
    expect(callCount).toBe(2);
  });

  it('aceita JSON dentro de cerca de código markdown', async () => {
    process.env.AI_API_KEY = 'chave-de-teste-suficientemente-longa';
    process.env.AI_PROVIDER = 'groq';

    setAiProvider({
      async call() {
        return '```json\n' + JSON.stringify({ cuts: [validCut()] }) + '\n```';
      },
    });

    const result = await analyzeWithAi(options);
    expect(result.cuts).toHaveLength(1);
  });

  it('inclui duração do vídeo no prompt para evitar timestamps inventados', async () => {
    process.env.AI_API_KEY = 'chave-de-teste-suficientemente-longa';
    process.env.AI_PROVIDER = 'groq';

    let capturedPrompt = '';
    setAiProvider({
      async call(_system, user) {
        capturedPrompt = user;
        return JSON.stringify({ cuts: [validCut()] });
      },
    });

    await analyzeWithAi(options);
    expect(capturedPrompt).toContain('100.00');
    expect(capturedPrompt).toContain('0.00-10.00');
  });
});
