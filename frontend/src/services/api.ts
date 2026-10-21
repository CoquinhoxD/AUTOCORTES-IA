const rawBaseUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');

export const API_BASE_URL = rawBaseUrl || 'http://localhost:3000';

/** Em dev, o Vite faz proxy de /api e /static para o backend (ver vite.config.ts). */
export const USE_PROXY = !rawBaseUrl;

function resolveUrl(path: string): string {
  return USE_PROXY ? path : `${API_BASE_URL}${path}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(resolveUrl(path), init);
  } catch {
    throw new ApiError('Não foi possível conectar ao servidor. O backend está rodando?', 0);
  }

  if (!response.ok) {
    let message = `Erro ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // resposta sem JSON — mantém a mensagem padrão
    }
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

import type {
  AnalysisResult,
  HistoryResponse,
  JobStatus,
  Transcript,
  UploadResponse,
} from '../types';

export interface AiProviderInfo {
  id: string;
  name: string;
  requiresKey: boolean;
  defaultModel: string;
  models: string[];
  baseUrl?: string;
  configured: boolean;
  keyMasked: string;
  currentModel: string;
}

export interface PublicSettings {
  aiProvider: string;
  aiModel: string;
  aiHasKey: boolean;
  aiKeyMasked: string;
  aiProviders: AiProviderInfo[];
  aiProviderParams: Record<string, Record<string, unknown>>;
  transcriptionProvider: 'auto' | 'groq' | 'openai' | 'mock' | 'local';
  transcriptionModel: string;
  transcriptionDevice: 'auto' | 'cuda' | 'cpu';
  transcriptionComputeType: 'auto' | 'int8' | 'int8_float16' | 'float16' | 'float32';
  transcriptionLanguage: string;
  transcriptionHasKey: boolean;
  transcriptionKeyMasked: string;
  maxVideoSizeMb: number;
  secureStorageAvailable: boolean;
  targetCutSeconds: number;
  maxCuts: number;
  overlapThreshold: number;
  minCutDuration: number;
  maxCutDuration: number;
}

export interface SettingsPatch {
  aiProvider?: PublicSettings['aiProvider'];
  aiModel?: string;
  aiProviderParams?: Record<string, Record<string, unknown>>;
  transcriptionProvider?: PublicSettings['transcriptionProvider'];
  transcriptionModel?: string;
  transcriptionDevice?: PublicSettings['transcriptionDevice'];
  transcriptionComputeType?: PublicSettings['transcriptionComputeType'];
  transcriptionLanguage?: string;
  maxVideoSizeMb?: number;
  targetCutSeconds?: number;
  maxCuts?: number;
  overlapThreshold?: number;
  minCutDuration?: number;
  maxCutDuration?: number;
}

export const api = {
  upload(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    return request<UploadResponse>('/api/videos', {
      method: 'POST',
      body: formData,
    });
  },

  getStatus(videoId: string): Promise<JobStatus> {
    return request<JobStatus>(`/api/videos/${videoId}/status`);
  },

  getResult(videoId: string): Promise<AnalysisResult> {
    return request<AnalysisResult>(`/api/videos/${videoId}/result`);
  },

  getTranscript(videoId: string): Promise<Transcript> {
    return request<Transcript>(`/api/videos/${videoId}/transcript`);
  },

  getHistory(): Promise<HistoryResponse> {
    return request<HistoryResponse>('/api/videos');
  },

  getHealth(): Promise<{ status: string; maxVideoSizeMb: number }> {
    return request('/api/health');
  },

  /** Configurações do usuário — as chaves chegam mascaradas. */
  getSettings(): Promise<PublicSettings> {
    return request<PublicSettings>('/api/settings');
  },

  updateSettings(patch: Partial<SettingsPatch>): Promise<PublicSettings> {
    return request<PublicSettings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  },

  /** Testa uma chave de IA sem salvá-la. */
  testAiSettings(payload: { provider: string; apiKey: string; model?: string }): Promise<{ ok: boolean; message: string }> {
    return request('/api/settings/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  /** Salva API key para um provedor. */
  saveApiKey(payload: { provider: string; apiKey: string }): Promise<{ ok: boolean; message: string }> {
    return request('/api/settings/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  /** Remove API key de um provedor. */
  removeApiKey(payload: { provider: string }): Promise<{ ok: boolean; message: string }> {
    return request('/api/settings/key', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  /** Lista modelos do Ollama. */
  getOllamaModels(payload: { baseUrl?: string }): Promise<{ models: string[]; defaultModel: string }> {
    const params = new URLSearchParams();
    if (payload.baseUrl) params.set('baseUrl', payload.baseUrl);
    return request(`/api/settings/models/ollama?${params.toString()}`);
  },

  /** Salva chave de transcrição. */
  saveTranscriptionKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
    return request('/api/settings/transcription-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
  },

  /** Remove chave de transcrição. */
  removeTranscriptionKey(): Promise<{ ok: boolean; message: string }> {
    return request('/api/settings/transcription-key', {
      method: 'DELETE',
    });
  },

  /** Exporta um único corte. */
  exportCut(videoId: string, options: {
    startTime: number;
    endTime: number;
    reencode?: boolean;
    vertical?: boolean;
    addSubtitles?: boolean;
    subtitleStyle?: string;
  }): Promise<{ outputPath: string; filename: string; duration: number; size: number; downloadUrl: string }> {
    return request(`/api/videos/${videoId}/export-cut`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
  },

  /** Exporta múltiplos cortes em lote. */
  exportBatch(videoId: string, payload: { cuts: Array<{
    rank: number;
    startTime: number;
    endTime: number;
    reencode?: boolean;
    vertical?: boolean;
    addSubtitles?: boolean;
    subtitleStyle?: string;
  }> }): Promise<{ results: any[]; errors: any[]; total: number; failed: number }> {
    return request(`/api/videos/${videoId}/export-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  /** Atualiza um corte (metadados). */
  updateCut(videoId: string, cutId: string, data: any): Promise<any> {
    return request(`/api/videos/${videoId}/cuts/${cutId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },
};

/** URL absoluta do vídeo para o player aceitar Range requests. */
export function videoStreamUrl(videoId: string): string {
  return resolveUrl(`/api/videos/${videoId}/stream`);
}