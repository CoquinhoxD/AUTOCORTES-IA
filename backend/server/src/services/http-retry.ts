/**
 * Retry com backoff para limites de taxa.
 *
 * Os provedores gratuitos não cobram por token, mas limitam vazão. O caso mais
 * duro aqui é o Whisper do Groq no plano free: 7.200 segundos de áudio por
 * hora. Uma live de 2h22 tem 8.545 segundos — ou seja, o pipeline *sempre*
 * toma 429 no meio do caminho, sem retry o job inteiro morre.
 */

export interface RetryOptions {
  /** Quantas tentativas no total (1 = sem retry). */
  attempts?: number;
  /** Espera inicial em ms; dobra a cada tentativa. */
  baseDelayMs?: number;
  /** Teto da espera, para não passar do limite da janela do provedor. */
  maxDelayMs?: number;
  /** Rótulo para o log. */
  label?: string;
  /** Injeta o atraso — os testes não devem esperar de verdade. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Extrai o `retry-after` (segundos ou data HTTP) de uma resposta 429. */
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());

  return null;
}

/**
 * Executa `operation` repetindo enquanto a API responder 429/5xx.
 * Qualquer outro erro (4xx de verdade: chave inválida, modelo inexistente)
 * propaga na hora — retry não conserta request inválido.
 */
export async function withRateLimitRetry<T>(
  operation: (attempt: number) => Promise<Response>,
  consume: (response: Response) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    attempts = 5,
    baseDelayMs = 2_000,
    maxDelayMs = 60_000,
    label = 'API',
    sleep = defaultSleep,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await operation(attempt);

    if (response.ok) return consume(response);

    // Erro definitivo: não adianta tentar de novo.
    if (response.status !== 429 && response.status < 500) {
      const body = await response.text();
      throw new Error(`${label} error ${response.status}: ${body.slice(0, 400)}`);
    }

    const serverHint = retryAfterMs(response);
    const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
    const waitMs = serverHint ?? backoff;

    if (attempt === attempts) {
      const body = await response.text();
      throw new Error(
        `${label} error ${response.status} após ${attempts} tentativas: ${body.slice(0, 400)}`
      );
    }

    const reason = response.status === 429 ? 'limite de taxa' : `erro ${response.status}`;
    console.warn(
      `[RETRY] ${label}: ${reason}. Tentativa ${attempt}/${attempts} — ` +
        `aguardando ${Math.round(waitMs / 1000)}s`
    );

    await sleep(waitMs);
  }

  /* c8 ignore next */
  throw lastError ?? new Error(`${label}: esgotadas as tentativas`);
}