import {
  analyzeWithAi,
  estimateTokens,
  splitSegmentsIntoBatches,
  setAiProvider,
} from '../server/src/services/ai-analysis.service.js';
import type { AnalyzeOptions } from '../server/src/services/ai-analysis.service.js';

/** Segmento sintético com texto comprido o bastante para estourar o orçamento. */
function makeSegments(count: number, textSize = 400) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    start: i * 8,
    end: i * 8 + 7.5,
    text: `fala ${i} ${'palavra '.repeat(Math.ceil(textSize / 8))}`.trim(),
  }));
}

function makeOptions(segments: AnalyzeOptions['segments']): AnalyzeOptions {
  const last = segments[segments.length - 1];
  return {
    fullText: segments.map((s) => s.text).join(' '),
    segments,
    videoDuration: last.end + 5,
    language: 'pt',
  };
}

describe('estimateTokens', () => {
  it('cresce com o tamanho do texto', () => {
    expect(estimateTokens('a')).toBeGreaterThan(0);
    expect(estimateTokens('a'.repeat(3500))).toBe(1000);
  });
});

describe('splitSegmentsIntoBatches', () => {
  it('não descarta o final mesmo quando passa de 40 blocos', () => {
    const segments = makeSegments(1500, 400);
    const batches = splitSegmentsIntoBatches(segments);
    expect(batches.length).toBeGreaterThan(40);
    expect(batches.flat()).toHaveLength(segments.length);
    expect(batches.flat().at(-1)).toEqual(segments.at(-1));
  });
  it('mantém a transcrição inteira — nenhum segmento some', () => {
    const segments = makeSegments(400);
    const batches = splitSegmentsIntoBatches(segments);

    const total = batches.reduce((sum, b) => sum + b.length, 0);
    expect(total).toBe(segments.length);
  });

  it('preserva a ordem cronológica entre e dentro dos blocos', () => {
    const segments = makeSegments(400);
    const flat = splitSegmentsIntoBatches(segments).flat();

    expect(flat.map((s) => s.start)).toEqual(segments.map((s) => s.start));
  });

  it('respeita o orçamento de tokens por bloco', () => {
    const segments = makeSegments(400);
    const budget = 3_200;

    for (const batch of splitSegmentsIntoBatches(segments, budget)) {
      const chars = batch.reduce((sum, s) => sum + s.text.length, 0);
      expect(estimateTokens('x'.repeat(chars))).toBeLessThanOrEqual(budget);
    }
  });

  it('divide mesmo quando cabe tudo em um bloco só', () => {
    const segments = makeSegments(400);
    expect(splitSegmentsIntoBatches(segments).length).toBeGreaterThan(1);
  });

  it('devolve um único bloco para transcrição curta', () => {
    const segments = makeSegments(3, 20);
    expect(splitSegmentsIntoBatches(segments)).toHaveLength(1);
  });
});

describe('analyzeWithAi com transcrição longa', () => {
  afterEach(() => setAiProvider(null));

  it('faz map-reduce quando a transcrição não cabe numa requisição', async () => {
    const prompts: string[] = [];
    let reduceFeito = false;

    setAiProvider({
      async call(_system, userPrompt) {
        prompts.push(userPrompt);

        const isReduce = userPrompt.includes('Candidatos extraídos');
        if (isReduce) {
          reduceFeito = true;
          return JSON.stringify({
            cuts: [
              {
                rank: 1,
                theme: 'Melhor do reduce',
                startTime: 0,
                endTime: 40,
                duration: 40,
                subject: 's',
                whyViral: 'w',
                hook: 'h',
                strongestMoment: 's',
                conclusion: 'c',
                retentionScore: 80,
                commentsScore: 70,
                sharesScore: 60,
                controversyScore: 50,
                curiosityScore: 85,
                emotionScore: 65,
                replayScore: 55,
                viralPotential: 90,
                headline: 'head',
                alternativeHeadline: 'alt',
              },
            ],
            controversies: [],
            top5: [1],
          });
        }

        // Cada bloco devolve um candidato.
        const m = userPrompt.match(/BLOCO (\d+) de/);
        const bloco = m ? Number(m[1]) : 1;
        return JSON.stringify({
          cuts: [
            {
              rank: 1,
              theme: `Candidato do bloco ${bloco}`,
              startTime: (bloco - 1) * 100,
              endTime: (bloco - 1) * 100 + 40,
              duration: 40,
              subject: 's',
              whyViral: 'w',
              hook: 'h',
              strongestMoment: 's',
              conclusion: 'c',
              retentionScore: 70,
              commentsScore: 60,
              sharesScore: 50,
              controversyScore: 40,
              curiosityScore: 75,
              emotionScore: 55,
              replayScore: 45,
              viralPotential: 75,
              headline: 'h1',
              alternativeHeadline: 'a1',
            },
          ],
          controversies: [],
          top5: [1],
        });
      },
    });

    const options = makeOptions(makeSegments(400));
    const result = await analyzeWithAi(options);

    expect(prompts.length).toBeGreaterThan(1);
    expect(reduceFeito).toBe(true);
    expect(result.cuts).toHaveLength(1);
    expect(result.cuts[0].theme).toBe('Melhor do reduce');
  });

  it('cai para os candidatos dos blocos se o reduce falhar', async () => {
    let chamadas = 0;

    setAiProvider({
      async call(_system, userPrompt) {
        chamadas++;

        if (userPrompt.includes('Candidatos extraídos')) {
          throw new Error('413 request too large');
        }

        return JSON.stringify({
          cuts: [
            {
              rank: 1,
              theme: 'Candidato',
              startTime: 0,
              endTime: 40,
              duration: 40,
              subject: 's',
              whyViral: 'w',
              hook: 'h',
              strongestMoment: 's',
              conclusion: 'c',
              retentionScore: 70,
              commentsScore: 60,
              sharesScore: 50,
              controversyScore: 40,
              curiosityScore: 75,
              emotionScore: 55,
              replayScore: 45,
              viralPotential: 75,
              headline: 'h',
              alternativeHeadline: 'a',
            },
          ],
          controversies: ['polêmica'],
          top5: [1],
        });
      },
    });

    const result = await analyzeWithAi(makeOptions(makeSegments(400)));

    // Reduce falhou, mas os candidatos dos blocos salvaram o job.
    expect(chamadas).toBeGreaterThan(1);
    expect(result.cuts.length).toBeGreaterThan(0);
    expect(result.cuts[0].theme).toBe('Candidato');
    expect(result.controversies).toContain('polêmica');
  });

  it('sobrevive a um bloco que falha', async () => {
    let blocoAtual = 0;

    setAiProvider({
      async call(_system, userPrompt) {
        if (userPrompt.includes('Candidatos extraídos')) {
          return JSON.stringify({ cuts: [], controversies: [], top5: [] });
        }

        blocoAtual++;
        if (blocoAtual === 2) throw new Error('bloco com problema');

        return JSON.stringify({
          cuts: [
            {
              rank: 1,
              theme: 'Bloco bom',
              startTime: 0,
              endTime: 40,
              duration: 40,
              subject: 's',
              whyViral: 'w',
              hook: 'h',
              strongestMoment: 's',
              conclusion: 'c',
              retentionScore: 70,
              commentsScore: 60,
              sharesScore: 50,
              controversyScore: 40,
              curiosityScore: 75,
              emotionScore: 55,
              replayScore: 45,
              viralPotential: 75,
              headline: 'h',
              alternativeHeadline: 'a',
            },
          ],
          controversies: [],
          top5: [1],
        });
      },
    });

    const result = await analyzeWithAi(makeOptions(makeSegments(400)));
    expect(result.cuts.length).toBeGreaterThan(0);
  });

  it('usa uma requisição só quando a transcrição é curta', async () => {
    let chamadas = 0;

    setAiProvider({
      async call() {
        chamadas++;
        return JSON.stringify({ cuts: [], controversies: [], top5: [] });
      },
    });

    await analyzeWithAi(makeOptions(makeSegments(3, 20)));
    expect(chamadas).toBe(1);
  });
});
