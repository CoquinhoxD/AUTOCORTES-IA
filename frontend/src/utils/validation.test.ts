import { validateVideoFile, getFileExtension } from './validation';

function makeFile(name: string, sizeBytes: number, type = 'video/mp4'): File {
  const file = new File([new ArrayBuffer(1)], name, { type });
  Object.defineProperty(file, 'size', { value: sizeBytes, configurable: true });
  return file;
}

describe('getFileExtension', () => {
  it('extrai extensão em minúsculas', () => {
    expect(getFileExtension('video.MP4')).toBe('.mp4');
    expect(getFileExtension('meu.video.final.mkv')).toBe('.mkv');
  });

  it('retorna string vazia quando não há extensão', () => {
    expect(getFileExtension('video')).toBe('');
  });
});

describe('validateVideoFile', () => {
  const maxMb = 2048;

  it('rejeita quando nenhum arquivo é selecionado', () => {
    const result = validateVideoFile(null, maxMb);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Selecione um vídeo');
  });

  it('aceita .mp4', () => {
    const result = validateVideoFile(makeFile('video.mp4', 1024), maxMb);
    expect(result.valid).toBe(true);
  });

  it('aceita .mov', () => {
    expect(validateVideoFile(makeFile('video.mov', 1024, 'video/quicktime'), maxMb).valid).toBe(true);
  });

  it('aceita .webm', () => {
    expect(validateVideoFile(makeFile('video.webm', 1024, 'video/webm'), maxMb).valid).toBe(true);
  });

  it('aceita .mkv', () => {
    expect(validateVideoFile(makeFile('video.mkv', 1024, 'video/x-matroska'), maxMb).valid).toBe(true);
  });

  it('rejeita extensão não suportada', () => {
    const result = validateVideoFile(makeFile('video.avi', 1024, 'video/x-msvideo'), maxMb);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Formato não suportado');
  });

  it('rejeita MIME type não suportado mesmo com extensão válida', () => {
    const result = validateVideoFile(makeFile('video.mp4', 1024, 'application/x-msdownload'), maxMb);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('não suportado');
  });

  it('rejeita arquivo acima do limite', () => {
    const result = validateVideoFile(makeFile('video.mp4', 3 * 1024 * 1024 * 1024), maxMb);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('excede o limite');
  });

  it('aceita arquivo exatamente no limite', () => {
    const result = validateVideoFile(makeFile('video.mp4', maxMb * 1024 * 1024), maxMb);
    expect(result.valid).toBe(true);
  });

  it('aceita vídeo de 4 GB dentro do limite de 5 GB', () => {
    const result = validateVideoFile(makeFile('video.mp4', 4 * 1024 * 1024 * 1024), 5120);
    expect(result.valid).toBe(true);
  });

  it('rejeita vídeo de 6 GB acima do limite de 5 GB', () => {
    const result = validateVideoFile(makeFile('video.mp4', 6 * 1024 * 1024 * 1024), 5120);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('5,0 GB');
  });

  it('formata o limite em MB quando menor que 1 GB', () => {
    const result = validateVideoFile(makeFile('video.mp4', 600 * 1024 * 1024), 512);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('512,0 MB');
  });

  it('aceita arquivo sem MIME type definido', () => {
    expect(validateVideoFile(makeFile('video.mp4', 1024, ''), maxMb).valid).toBe(true);
  });
});
