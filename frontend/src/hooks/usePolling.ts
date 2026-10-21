import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../services/api';

/**
 * Polling com intervalo configurável e barra de progresso visual.
 * A arquitetura permite trocar por SSE/WebSocket trocando apenas esta implementação,
 * pois os componentes consomem apenas { data, error, loading, refetch }.
 */
export interface PollingOptions {
  /** Milissegundos entre as chamadas. */
  intervalMs?: number;
  /** Quando true, não faz nenhuma requisição. */
  enabled?: boolean;
  /** Para o polling quando satisfied(data) retorna true. */
  until?: (data: unknown) => boolean;
  /** Callback opcional chamado a cada poll com o progresso atual { step, progress, message }.
   * Útil para barras de progresso deterministas (não depende de SSE).
   */
  onProgress?: (step: string, progress: number, message: string) => void;
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  { intervalMs = 2000, enabled = true, until, onProgress }: PollingOptions = {}
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);

  const mountedRef = useRef(true);
  const stopRef = useRef(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    mountedRef.current = true;
    stopRef.current = false;
    return () => {
      mountedRef.current = false;
      stopRef.current = true;
    };
  }, []);

  const run = useCallback(async () => {
    if (stopRef.current || !enabled) return;

    try {
      const result = await fetcherRef.current();
      if (!mountedRef.current || stopRef.current) return;

      setData(result);
      setError(null);

      // Chama onProgress se fornecido (para barra determinista)
      if (onProgress && result && typeof result === 'object' && 'status' in result) {
        const r = result as { status?: string; progress?: number; message?: string };
        onProgress(r.status ?? '', r.progress ?? 0, r.message ?? '');
      }

      if (until?.(result)) {
        stopRef.current = true;
      }
    } catch (caught) {
      if (!mountedRef.current || stopRef.current) return;

      setError(
        caught instanceof ApiError ? caught.message : 'Falha ao consultar o servidor.'
      );
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [enabled, until, onProgress]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    stopRef.current = false;
    void run();

    const timer = window.setInterval(() => {
      if (!stopRef.current) void run();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, run]);

  return { data, error, loading, refetch: run, stop: () => (stopRef.current = true) };
}