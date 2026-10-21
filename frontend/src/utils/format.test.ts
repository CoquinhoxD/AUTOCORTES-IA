import { formatTimecode, formatDuration, formatDurationShort, formatBytes, formatDate, scoreTone, formatResolution, formatFps } from './format';

describe('formatTimecode', () => {
  it('formata segundos em mm:ss', () => {
    expect(formatTimecode(0)).toBe('00:00');
    expect(formatTimecode(9)).toBe('00:09');
    expect(formatTimecode(59)).toBe('00:59');
    expect(formatTimecode(60)).toBe('01:00');
    expect(formatTimecode(95)).toBe('01:35');
  });

  it('formata hh:mm:ss quando passa de uma hora', () => {
    expect(formatTimecode(3661)).toBe('01:01:01');
    expect(formatTimecode(7325)).toBe('02:02:05');
  });

  it('força horas quando solicitado', () => {
    expect(formatTimecode(95, true)).toBe('00:01:35');
  });

  it('retorna 00:00 para valores inválidos', () => {
    expect(formatTimecode(-1)).toBe('00:00');
    expect(formatTimecode(NaN)).toBe('00:00');
    expect(formatTimecode(Infinity)).toBe('00:00');
  });

  it('trunca frações de segundo', () => {
    expect(formatTimecode(59.9)).toBe('00:59');
  });
});

describe('formatDuration', () => {
  it('formata segundos', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('formata minutos', () => {
    expect(formatDuration(60)).toBe('1min');
    expect(formatDuration(95)).toBe('1min 35s');
    expect(formatDuration(125)).toBe('2min 5s');
  });

  it('formata horas', () => {
    expect(formatDuration(3600)).toBe('1.0h');
    expect(formatDuration(7200)).toBe('2.0h');
  });

  it('retorna 0s para valores inválidos', () => {
    expect(formatDuration(-5)).toBe('0s');
    expect(formatDuration(NaN)).toBe('0s');
  });
});

describe('formatDurationShort', () => {
  it('formata com uma casa decimal e vírgula', () => {
    expect(formatDurationShort(39.62)).toBe('39,6s');
    expect(formatDurationShort(15)).toBe('15,0s');
  });

  it('retorna travessão para valores inválidos', () => {
    expect(formatDurationShort(NaN)).toBe('—');
  });
});

describe('formatBytes', () => {
  it('formata bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formata kilobytes', () => {
    expect(formatBytes(2048)).toBe('2,0 KB');
  });

  it('formata megabytes', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5,0 MB');
  });

  it('formata gigabytes', () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2,0 GB');
  });

  it('retorna 0 B para valores inválidos', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
  });
});

describe('formatDate', () => {
  it('formata data ISO', () => {
    const result = formatDate('2026-01-15T10:30:00.000Z');
    expect(result).not.toBe('—');
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('retorna travessão para data inválida', () => {
    expect(formatDate('data-invalida')).toBe('—');
  });
});

describe('scoreTone', () => {
  it('classifica scores altos', () => {
    expect(scoreTone(100)).toBe('high');
    expect(scoreTone(80)).toBe('high');
  });

  it('classifica scores médios', () => {
    expect(scoreTone(79)).toBe('medium');
    expect(scoreTone(60)).toBe('medium');
  });

  it('classifica scores baixos', () => {
    expect(scoreTone(59)).toBe('low');
    expect(scoreTone(0)).toBe('low');
  });
});

describe('formatResolution e formatFps', () => {
  it('formata resolução', () => {
    expect(formatResolution(1920, 1080)).toBe('1920×1080');
    expect(formatResolution(0, 0)).toBe('—');
  });

  it('formata fps', () => {
    expect(formatFps(30)).toBe('30 fps');
    expect(formatFps(29.97)).toBe('29,97 fps');
    expect(formatFps(0)).toBe('—');
  });
});
