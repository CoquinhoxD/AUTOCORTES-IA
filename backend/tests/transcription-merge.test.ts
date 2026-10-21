import { mergeChunkTranscriptions } from '../server/src/services/transcription-pipeline.service.js';
import type { Transcription } from '../server/src/services/transcription.service.js';

function chunk(starts: Array<[number, number]>): Transcription {
  const segments = starts.map(([start, end], id) => ({
    id,
    start,
    end,
    text: `fala ${start}`,
  }));
  return { segments, fullText: segments.map((s) => s.text).join(' ') };
}

describe('mergeChunkTranscriptions', () => {
  it('NÃO funde segmentos apenas encostados', () => {
    // Whisper entrega segmentos contíguos: 0-8, 8-16, 16-24...
    // A regra antiga encadeava tudo num único segmento.
    const resultado = mergeChunkTranscriptions(
      [chunk([[0, 8], [8, 16], [16, 24]])],
      [0]
    );

    expect(resultado.segments).toHaveLength(3);
  });

  it('funde a região compartilhada por dois chunks em um segmento só', () => {
    // Chunk A cobre 0–10; chunk B começa em 8 e cobre 8–12.
    // A região 8–10 é o MESMO áudio reportado duas vezes.
    const resultado = mergeChunkTranscriptions(
      [
        chunk([[0, 8], [8, 10]]),
        chunk([[0, 2], [2, 4]]),
      ],
      [0, 8]
    );

    const cobrindo = resultado.segments.filter((s) => s.start < 10 && s.end > 8);
    expect(cobrindo).toHaveLength(1);
    expect(cobrindo[0].start).toBe(8);
    expect(cobrindo[0].end).toBe(10);

    // O trecho que só existe no segundo chunk continua existindo.
    expect(resultado.segments.map((s) => s.text).join(' ')).toContain('fala 2');
  });

  it('mantém a ordem cronológica ao mesclar chunks', () => {
    const resultado = mergeChunkTranscriptions(
      [chunk([[0, 10], [10, 20]]), chunk([[0, 10], [10, 20]])],
      [0, 18]
    );

    for (let i = 1; i < resultado.segments.length; i++) {
      expect(resultado.segments[i].start).toBeGreaterThanOrEqual(
        resultado.segments[i - 1].start
      );
    }
  });

  it('cobre todo o vídeo sem buracos grandes', () => {
    // 3 chunks de 10s começando em 0, 8 e 16 (sobreposição de 2s).
    const resultado = mergeChunkTranscriptions(
      [chunk([[0, 10], [10, 20], [20, 30]]), chunk([[0, 10]]), chunk([[0, 14]])],
      [0, 8, 16]
    );

    const primeiro = resultado.segments[0].start;
    const ultimo = resultado.segments[resultado.segments.length - 1].end;

    expect(primeiro).toBeLessThanOrEqual(0);
    expect(ultimo).toBeGreaterThanOrEqual(28);
  });
});