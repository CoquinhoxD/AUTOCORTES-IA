import { describe, it, expect } from '@jest/globals';
import {
  validateCuts,
  computeDuration,
  timestampMatchesSegment,
  MIN_CUT_DURATION,
  MAX_CUT_DURATION,
  type CutValidationContext,
} from '../server/src/services/cut-validator.service.js';
import type { AICut } from '../server/src/services/ai-analysis.schema.js';

function makeCut(overrides: Partial<AICut> = {}): AICut {
  return {
    rank: 1,
    theme: 'Tema de teste',
    startTime: 10,
    endTime: 40,
    duration: 30,
    subject: 'Assunto de teste',
    whyViral: 'Porque é envolvente',
    hook: 'Gancho forte',
    strongestMoment: 'Momento alto',
    conclusion: 'Conclusão clara',
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
    headline: 'Headline principal',
    alternativeHeadline: 'Headline alternativa',
    ...overrides,
  };
}

/** Segmentos que cobrem 0�?"200s para permitir qualquer timestamp nessa faixa. */
const segments = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  start: i * 10,
  end: (i + 1) * 10,
  text: `Segmento ${i}`,
}));

const context: CutValidationContext = {
  videoDuration: 200,
  segments,
  maxCuts: 20,
};

describe('computeDuration', () => {
  it('calcula duração corretamente', () => {
    expect(computeDuration(10.5, 45.2)).toBeCloseTo(34.7, 3);
  });

  it('retorna zero quando start e end são iguais', () => {
    expect(computeDuration(10, 10)).toBe(0);
  });

  it('arredonda para 3 casas decimais', () => {
    expect(computeDuration(0, 1.23456)).toBe(1.235);
  });
});

describe('timestampMatchesSegment', () => {
  it('encontra timestamp dentro de um segmento', () => {
    expect(timestampMatchesSegment(15, segments)).toBe(true);
  });

  it('encontra timestamp exatamente no início do segmento', () => {
    expect(timestampMatchesSegment(10, segments)).toBe(true);
  });

  it('encontra timestamp exatamente no fim do segmento', () => {
    expect(timestampMatchesSegment(20, segments)).toBe(true);
  });

  it('rejeita timestamp fora dos segmentos', () => {
    expect(timestampMatchesSegment(500, segments)).toBe(false);
  });

  it('respeita a tolerância configurada', () => {
    // 20.5 está 0.5s após o fim do segmento [10,20] �?" dentro da tolerância de 1.5s
    expect(timestampMatchesSegment(20.5, segments, 1.5)).toBe(true);
    // 202 está além do último segmento (termina em 200) e excede a tolerância
    expect(timestampMatchesSegment(202, segments, 1.5)).toBe(false);
  });
});

describe('validateCuts �?"timestamps', () => {
  it('rejeita startTime negativo', () => {
    const report = validateCuts([makeCut({ startTime: -5, endTime: 30 })], context);

    expect(report.cuts).toHaveLength(0);
    expect(report.rejected[0].reason).toContain('startTime negativo');
  });

  it('rejeita endTime menor ou igual a startTime', () => {
    const report = validateCuts([makeCut({ startTime: 30, endTime: 30 })], context);

    expect(report.cuts).toHaveLength(0);
    expect(report.rejected[0].reason).toContain('endTime');
  });

  it('rejeita endTime maior que a duração do vídeo', () => {
    const report = validateCuts([makeCut({ startTime: 150, endTime: 250 })], context);

    expect(report.cuts).toHaveLength(0);
    expect(report.rejected[0].reason).toContain('excede duração do vídeo');
  });

  it('rejeita timestamp que não corresponde a nenhum segmento', () => {
    const sparseSegments = [
      { id: 0, start: 0, end: 10, text: 'A' },
      { id: 1, start: 90, end: 100, text: 'B' },
    ];

    const report = validateCuts([makeCut({ startTime: 50, endTime: 70 })], {
      videoDuration: 200,
      segments: sparseSegments,
    });

    expect(report.cuts).toHaveLength(0);
    expect(report.rejected[0].reason).toContain('não corresponde a nenhum segmento');
  });

  it('recalcula duration ignorando o valor informado pela IA', () => {
    const report = validateCuts(
      [makeCut({ startTime: 10, endTime: 40, duration: 9999 })],
      context
    );

    expect(report.cuts[0].duration).toBe(30);
  });

  it('aceita corte exatamente no limite da duração', () => {
    const report = validateCuts([makeCut({ startTime: 160, endTime: 200 })], context);

    expect(report.cuts).toHaveLength(1);
  });
});

describe('validateCuts �?" duração aceitável', () => {
  it('rejeita corte mais curto que o mínimo', () => {
    const report = validateCuts([makeCut({ startTime: 10, endTime: 10 + MIN_CUT_DURATION - 1 })], context);

    expect(report.cuts).toHaveLength(0);
    expect(report.rejected[0].reason).toContain('muito curta');
  });

  it('rejeita corte mais longo que o máximo', () => {
    const report = validateCuts([makeCut({ startTime: 0, endTime: MAX_CUT_DURATION + 10 })], context);

    expect(report.cuts).toHaveLength(0);
    expect(report.rejected[0].reason).toContain('muito longa');
  });

  it('aceita corte exatamente no mínimo', () => {
    const report = validateCuts([makeCut({ startTime: 10, endTime: 10 + MIN_CUT_DURATION })], context);

    expect(report.cuts).toHaveLength(1);
  });
});

describe('validateCuts �?" ranking global', () => {
  it('ordena por viralPotential decrescente', () => {
    const report = validateCuts(
      [
        makeCut({ rank: 1, startTime: 0, endTime: 30, scores: { ...makeCut().scores!, viralPotential: 50 } }),
        makeCut({ rank: 2, startTime: 40, endTime: 70, scores: { ...makeCut().scores!, viralPotential: 95 } }),
        makeCut({ rank: 3, startTime: 80, endTime: 110, scores: { ...makeCut().scores!, viralPotential: 70 } }),
      ],
      context
    );

    expect(report.cuts.map((c) => c.viralPotential)).toEqual([95, 70, 50]);
  });

  it('reatribui ranks globais sequenciais', () => {
    const report = validateCuts(
      [
        makeCut({ rank: 7, startTime: 0, endTime: 30, scores: { ...makeCut().scores!, viralPotential: 50 } }),
        makeCut({ rank: 3, startTime: 40, endTime: 70, scores: { ...makeCut().scores!, viralPotential: 90 } }),
      ],
      context
    );

    expect(report.cuts.map((c) => c.rank)).toEqual([1, 2]);
  });

  it('desempata por retention quando viralPotential é igual', () => {
    const report = validateCuts(
      [
        makeCut({
          rank: 1,
          startTime: 0,
          endTime: 30,
          scores: { ...makeCut().scores!, viralPotential: 80, retention: 60 },
        }),
        makeCut({
          rank: 2,
          startTime: 40,
          endTime: 70,
          scores: { ...makeCut().scores!, viralPotential: 80, retention: 95 },
        }),
      ],
      context
    );

    expect(report.cuts[0].retentionScore).toBe(95);
  });

  it('remove cortes duplicados ou sobrepostos', () => {
    const report = validateCuts(
      [
        makeCut({ rank: 1, startTime: 0, endTime: 40, scores: { ...makeCut().scores!, viralPotential: 90 } }),
        makeCut({ rank: 2, startTime: 5, endTime: 45, scores: { ...makeCut().scores!, viralPotential: 95 } }),
      ],
      context
    );

    expect(report.cuts).toHaveLength(1);
    expect(report.rejected[0].reason).toContain('duplicado ou sobreposto');
  });

  it('mantém cortes parcialmente sobrepostos abaixo de 60%', () => {
    const report = validateCuts(
      [
        makeCut({ rank: 1, startTime: 0, endTime: 40, scores: { ...makeCut().scores!, viralPotential: 90 } }),
        makeCut({ rank: 2, startTime: 30, endTime: 60, scores: { ...makeCut().scores!, viralPotential: 95 } }),
      ],
      context
    );

    expect(report.cuts).toHaveLength(2);
  });
});

describe('validateCuts �?" meta de 20 cortes', () => {
  /** Gera cortes distintos covering toda a janela de 200s. */
  function makeManyCuts(count: number): AICut[] {
    const windowSize = 200 / count;
    return Array.from({ length: count }, (_, i) =>
      makeCut({
        rank: i + 1,
        startTime: i * windowSize,
        endTime: (i + 1) * windowSize,
        scores: {
          ...makeCut().scores!,
          viralPotential: 100 - i,
        },
      })
    );
  }

  it('retorna exatamente 20 cortes quando há material suficiente', () => {
    const report = validateCuts(makeManyCuts(25), context);

    expect(report.cuts).toHaveLength(20);
    expect(report.reachedTarget).toBe(true);
    expect(report.notice).toBeUndefined();
  });

  it('nunca distribui 20 por bloco �?" o ranking é global', () => {
    // Vídeo longo com candidatos distribuídos ao longo de toda a duração.
    const longDuration = 1800;
    const longSegments = Array.from({ length: 180 }, (_, i) => ({
      id: i,
      start: i * 10,
      end: (i + 1) * 10,
      text: `Segmento ${i}`,
    }));
    const longContext: CutValidationContext = {
      videoDuration: longDuration,
      segments: longSegments,
      maxCuts: 20,
    };

    // 60 candidatos concorrentes, todos com 25s de duração e espalhados
    const step = longDuration / 60;
    const candidates = Array.from({ length: 60 }, (_, i) =>
      makeCut({
        rank: i + 1,
        startTime: i * step,
        endTime: i * step + 25,
        scores: { ...makeCut().scores!, viralPotential: 100 - i },
      })
    );

    const report = validateCuts(candidates, longContext);

    expect(report.cuts).toHaveLength(20);
    // Os 20 melhores devem estar espalhados, não concentrados no início
    const starts = report.cuts.map((c) => c.startTime);
    expect(Math.max(...starts)).toBeGreaterThan(100);
  });

  it('retorna menos de 20 com aviso claro quando falta material', () => {
    const report = validateCuts(makeManyCuts(3), context);

    expect(report.cuts).toHaveLength(3);
    expect(report.reachedTarget).toBe(false);
    expect(report.notice).toContain('não possui 20 candidatos válidos');
    expect(report.notice).toContain('3 corte(s)');
  });

  it('respeita maxCuts customizado', () => {
    const report = validateCuts(makeManyCuts(25), { ...context, maxCuts: 5 });

    expect(report.cuts).toHaveLength(5);
  });

  it('retorna lista vazia sem erro quando a IA não devolve cortes', () => {
    const report = validateCuts([], context);

    expect(report.cuts).toHaveLength(0);
    expect(report.reachedTarget).toBe(false);
    expect(report.notice).toContain('0 corte(s)');
  });
});

describe('validateCuts �?" fallback sem transcrição', () => {
  it('não valida timestamps quando não há segmentos', () => {
    const report = validateCuts([makeCut({ startTime: 10, endTime: 40 })], {
      videoDuration: 200,
      segments: [],
    });

    expect(report.cuts).toHaveLength(1);
  });
});
