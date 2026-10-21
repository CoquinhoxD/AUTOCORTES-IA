import { withRateLimitRetry } from '../server/src/services/http-retry.js';

function resposta(init: ResponseInit): Response {
  return new Response('body', init);
}

describe('withRateLimitRetry', () => {
  it('não espera quando a primeira tentativa funciona', async () => {
    const espera: number[] = [];
    const resultado = await withRateLimitRetry(
      async () => resposta({ status: 200 }),
      async () => 'ok',
      { sleep: async (ms) => void espera.push(ms) }
    );

    expect(resultado).toBe('ok');
    expect(espera).toHaveLength(0);
  });

  it('espera e repete no 429', async () => {
    const espera: number[] = [];
    let chamadas = 0;

    const resultado = await withRateLimitRetry(
      async () => {
        chamadas++;
        return chamadas < 3 ? resposta({ status: 429 }) : resposta({ status: 200 });
      },
      async () => 'ok',
      { sleep: async (ms) => void espera.push(ms), label: 'teste' }
    );

    expect(resultado).toBe('ok');
    expect(chamadas).toBe(3);
    expect(espera).toHaveLength(2);
  });

  it('respeita o header retry-after em segundos', async () => {
    const espera: number[] = [];

    await withRateLimitRetry(
      async () =>
        resposta({ status: 429, headers: { 'retry-after': '7' } }),
      async () => 'ok',
      { sleep: async (ms) => void espera.push(ms) }
    ).catch(() => undefined);

    // 7000ms vem do header, não do backoff padrão de 2s.
    expect(espera[0]).toBe(7000);
  });

  it('faz backoff exponencial quando não há retry-after', async () => {
    const espera: number[] = [];

    await withRateLimitRetry(
      async () => resposta({ status: 429 }),
      async () => 'ok',
      { sleep: async (ms) => void espera.push(ms), attempts: 4 }
    ).catch(() => undefined);

    expect(espera).toEqual([2000, 4000, 8000]);
  });

  it('NÃO repete em erro definitivo de cliente', async () => {
    let chamadas = 0;

    await expect(
      withRateLimitRetry(
        async () => {
          chamadas++;
          return resposta({ status: 400 });
        },
        async () => 'nunca',
        { sleep: async () => undefined }
      )
    ).rejects.toThrow(/400/);

    // Chave inválida ou modelo inexistente não melhoram com retry.
    expect(chamadas).toBe(1);
  });

  it('repete em erro de servidor 5xx', async () => {
    let chamadas = 0;

    const resultado = await withRateLimitRetry(
      async () => {
        chamadas++;
        return chamadas < 2 ? resposta({ status: 503 }) : resposta({ status: 200 });
      },
      async () => 'ok',
      { sleep: async () => undefined }
    );

    expect(resultado).toBe('ok');
    expect(chamadas).toBe(2);
  });

  it('desiste depois do número de tentativas', async () => {
    await expect(
      withRateLimitRetry(
        async () => resposta({ status: 429 }),
        async () => 'ok',
        { attempts: 3, sleep: async () => undefined }
      )
    ).rejects.toThrow(/após 3 tentativas/);
  });
});