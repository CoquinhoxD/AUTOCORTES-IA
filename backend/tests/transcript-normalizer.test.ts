import { describe, it, expect } from '@jest/globals';
import { normalizeTranscription } from '../server/src/services/transcript-normalizer.service.js';

describe('normalizeTranscription', () => {
  it('remove segmentos vazios ou sem texto', () => {
    const result = normalizeTranscription([
      { id: 0, start: 0, end: 5, text: 'Primeiro segmento' },
      { id: 1, start: 5, end: 8, text: '   ' },
      { id: 2, start: 8, end: 12, text: 'Segundo segmento' },
      { id: 3, start: 12, end: 14, text: '' },
    ]);

    expect(result.segments).toHaveLength(2);
    expect(result.diagnostics.removedEmptySegments).toBe(2);
  });

  it('normaliza espaços mas preserva pontuação', () => {
    const result = normalizeTranscription([
      { id: 0, start: 0, end: 5, text: '  Olá   mundo ,  como   vai ?  ' },
    ]);

    expect(result.segments[0].text).toBe('Olá mundo, como vai?');
  });

  it('preserva pontuação original', () => {
    const text = 'Eu nunca contei isso! Mas... será que aconteceu mesmo?';
    const result = normalizeTranscription([{ id: 0, start: 0, end: 5, text }]);

    expect(result.segments[0].text).toBe(text);
  });

  it('mantém ordem cronológica reordenando quando necessário', () => {
    const result = normalizeTranscription([
      { id: 0, start: 10, end: 15, text: 'Segundo' },
      { id: 1, start: 0, end: 5, text: 'Primeiro' },
    ]);

    expect(result.segments[0].text).toBe('Primeiro');
    expect(result.segments[1].text).toBe('Segundo');
    expect(result.diagnostics.isChronological).toBe(false);
  });

  it('preserva ordem cronológica quando já está correta', () => {
    const result = normalizeTranscription([
      { id: 0, start: 0, end: 5, text: 'A' },
      { id: 1, start: 5, end: 10, text: 'B' },
      { id: 2, start: 10, end: 15, text: 'C' },
    ]);

    expect(result.diagnostics.isChronological).toBe(true);
    expect(result.segments.map((s) => s.text)).toEqual(['A', 'B', 'C']);
  });

  it('reindexa ids sequencialmente', () => {
    const result = normalizeTranscription([
      { id: 47, start: 10, end: 15, text: 'B' },
      { id: 99, start: 0, end: 5, text: 'A' },
    ]);

    expect(result.segments[0].id).toBe(0);
    expect(result.segments[1].id).toBe(1);
  });

  it('gera fullText com todos os segmentos', () => {
    const result = normalizeTranscription([
      { id: 0, start: 0, end: 5, text: 'Primeira parte' },
      { id: 1, start: 5, end: 10, text: 'Segunda parte' },
    ]);

    expect(result.fullText).toBe('Primeira parte Segunda parte');
  });

  it('descarta segmentos com endTime menor que startTime', () => {
    const result = normalizeTranscription([
      { id: 0, start: 10, end: 5, text: 'Inválido' },
      { id: 1, start: 0, end: 5, text: 'Válido' },
    ]);

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('Válido');
  });

  it('detecta transcrição vazia como suspeita', () => {
    const result = normalizeTranscription([{ id: 0, start: 0, end: 5, text: '' }]);

    expect(result.segments).toHaveLength(0);
    expect(result.diagnostics.suspicious).toBe(true);
    expect(result.diagnostics.warnings.join(' ')).toContain('TRANSCRIÇÃO VAZIA');
  });

  it('detecta velocidade de fala implausível', () => {
    const result = normalizeTranscription([
      { id: 0, start: 0, end: 2, text: 'palavra '.repeat(30) },
    ]);

    expect(result.diagnostics.wordsPerMinute).toBeGreaterThan(400);
    expect(result.diagnostics.warnings.join(' ')).toContain('transcrição corrompida');
  });

  it('não marca como suspeito uma fala normal', () => {
    const result = normalizeTranscription([
      { id: 0, start: 0, end: 30, text: 'Esta é uma fala perfeitamente normal com ritmo de fala humano e natural.' },
    ]);

    expect(result.diagnostics.suspicious).toBe(false);
  });

  it('clamp startTime negativo para zero', () => {
    const result = normalizeTranscription([{ id: 0, start: -3, end: 5, text: 'Texto' }]);

    expect(result.segments[0].start).toBe(0);
  });
});
