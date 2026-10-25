import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './paths.js';
import { loadSecrets, saveSecrets, isSecureStorageAvailable } from '../lib/secure-storage.js';

/**
 * Configuração persistida do usuário.
 *
 * No app desktop as chaves não vivem no `.env` (que fica dentro do pacote
 * instalado e é sobrescrito a cada update) — ficam em `config.json` na
 * pasta de dados, e são injetadas em `process.env` na inicialização.
 * 
 * API Keys sensíveis são armazenadas criptografadas em `secrets.enc`
 * usando AES-256-GCM com chave derivada via DPAPI (Windows) ou scrypt.
 */

export type AiProviderId = 'groq' | 'openai' | 'gemini' | 'ollama' | 'local';

export interface AiProviderConfig {
  /** Identificador do provedor. */
  id: AiProviderId;
  /** Nome amigável. */
  name: string;
  /** Se requer API key. */
  requiresKey: boolean;
  /** Modelos disponíveis (carregados dinamicamente quando possível). */
  models?: string[];
  /** Modelo padrão. */
  defaultModel: string;
  /** URL base da API (para OpenAI-compatíveis). */
  baseUrl?: string;
  /** Parâmetros extras para o modelo. */
  extraParams?: Record<string, unknown>;
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderConfig> = {
  groq: {
    id: 'groq',
    name: 'Groq',
    requiresKey: true,
    defaultModel: 'openai/gpt-oss-120b',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    models: [
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b',
    ],
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    requiresKey: true,
    defaultModel: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-3.5-turbo',
    ],
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    requiresKey: true,
    defaultModel: 'gemini-1.5-pro',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    models: [
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-1.0-pro',
    ],
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (Local)',
    requiresKey: false,
    defaultModel: 'llama3.1:8b',
    baseUrl: 'http://localhost:11434/v1/chat/completions',
    models: [], // Carregados dinamicamente via API do Ollama
  },
  local: {
    id: 'local',
    name: 'Gerador Local (Heurístico)',
    requiresKey: false,
    defaultModel: 'heuristic-v1',
    models: ['heuristic-v1'],
  },
};

export interface AppSettings {
  /** Provedor de IA ativo. */
  aiProvider: AiProviderId;
  /** Modelo selecionado para o provedor ativo. */
  aiModel: string;
  /** Parâmetros extras por provedor (ex: temperature, top_p). */
  aiProviderParams?: Record<AiProviderId, Record<string, unknown>>;
  
  /** Provedor de transcrição ativo. */
  transcriptionProvider: 'auto' | 'groq' | 'openai' | 'mock' | 'local';
  /** Modelo Whisper para transcrição. */
  transcriptionModel: string;
  /** Dispositivo de processamento: auto, cuda, cpu. */
  transcriptionDevice: 'auto' | 'cuda' | 'cpu';
  /** Tipo de precisão: auto, int8, int8_float16, float16, float32. */
  transcriptionComputeType: 'auto' | 'int8' | 'int8_float16' | 'float16' | 'float32';
  /** Idioma da transcrição. */
  transcriptionLanguage: string;
  
  /** Limite de upload em MB. */
  maxVideoSizeMb: number;

  // --- Parâmetros de análise (P0) ---
  /** Duração alvo de cada corte em segundos. */
  targetCutSeconds: number;
  /** Número máximo de cortes a gerar. */
  maxCuts: number;
  /** Limiar de sobreposição para descartar duplicados (0.0 a 1.0). */
  overlapThreshold: number;
  /** Duração mínima de um corte em segundos. */
  minCutDuration: number;
  /** Duração máxima de um corte em segundos. */
  maxCutDuration: number;
}

/** Chaves de segredo por provedor (armazenadas criptografadas). */
const SECRET_KEYS: Record<AiProviderId, string> = {
  groq: 'ai_key_groq',
  openai: 'ai_key_openai',
  gemini: 'ai_key_gemini',
  ollama: 'ai_key_ollama',
  local: '',
};

const SETTINGS_FILE = path.join(PATHS.data, 'config.json');

const EMPTY_PROVIDER_PARAMS: Record<AiProviderId, Record<string, unknown>> = {
  groq: {},
  openai: {},
  gemini: {},
  ollama: {},
  local: {},
};

const DEFAULTS: AppSettings = {
  aiProvider: 'local',
  aiModel: 'heuristic-v1',
  aiProviderParams: EMPTY_PROVIDER_PARAMS,
  transcriptionProvider: 'auto',
  transcriptionModel: 'small',
  transcriptionDevice: 'auto',
  transcriptionComputeType: 'auto',
  transcriptionLanguage: 'pt',
  maxVideoSizeMb: 5120,
  targetCutSeconds: 45,
  maxCuts: 20,
  overlapThreshold: 0.6,
  minCutDuration: 5,
  maxCutDuration: 180,
};

/** Mescla o arquivo salvo sobre os defaults, ignorando campos inválidos. */
function parse(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  const data = raw as Partial<Record<keyof AppSettings, unknown>>;

  const str = (value: unknown, fallback: string): string =>
    typeof value === 'string' ? value.trim() : fallback;
  const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value)
      ? (value as T)
      : fallback;
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;

  const providerIds: AiProviderId[] = ['groq', 'openai', 'gemini', 'ollama', 'local'];

  return {
    aiProvider: oneOf(data.aiProvider, providerIds, DEFAULTS.aiProvider),
    aiModel: str(data.aiModel, DEFAULTS.aiModel),
    aiProviderParams: (() => {
      if (data.aiProviderParams && typeof data.aiProviderParams === 'object') {
        const params: Record<AiProviderId, Record<string, unknown>> = {
          groq: {},
          openai: {},
          gemini: {},
          ollama: {},
          local: {},
        };
        const providerParams = data.aiProviderParams as Partial<Record<AiProviderId, unknown>>;
        for (const pid of providerIds) {
          const providerData = providerParams[pid];
          if (providerData && typeof providerData === 'object') {
            params[pid] = providerData as Record<string, unknown>;
          }
        }
        return params;
      }
      return DEFAULTS.aiProviderParams;
    })(),
    transcriptionProvider: oneOf(
      data.transcriptionProvider,
      ['auto', 'groq', 'openai', 'mock', 'local'],
      DEFAULTS.transcriptionProvider
    ),
    transcriptionModel: str(data.transcriptionModel, DEFAULTS.transcriptionModel),
    transcriptionDevice: oneOf(
      data.transcriptionDevice,
      ['auto', 'cuda', 'cpu'],
      DEFAULTS.transcriptionDevice
    ),
    transcriptionComputeType: oneOf(
      data.transcriptionComputeType,
      ['auto', 'int8', 'int8_float16', 'float16', 'float32'],
      DEFAULTS.transcriptionComputeType
    ),
    transcriptionLanguage: str(data.transcriptionLanguage, DEFAULTS.transcriptionLanguage),
    maxVideoSizeMb: num(data.maxVideoSizeMb, DEFAULTS.maxVideoSizeMb),

    // Parâmetros de análise (P0)
    targetCutSeconds: num(data.targetCutSeconds, DEFAULTS.targetCutSeconds),
    maxCuts: num(data.maxCuts, DEFAULTS.maxCuts),
    overlapThreshold: (() => {
      const v = typeof data.overlapThreshold === 'number' && Number.isFinite(data.overlapThreshold)
        ? data.overlapThreshold
        : DEFAULTS.overlapThreshold;
      return Math.max(0, Math.min(1, v));
    })(),
    minCutDuration: num(data.minCutDuration, DEFAULTS.minCutDuration),
    maxCutDuration: num(data.maxCutDuration, DEFAULTS.maxCutDuration),
  };
}

export function readSettings(): AppSettings {
  try {
    return parse(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')));
  } catch {
    // Sem arquivo (primeiro boot) ou JSON corrompido — usa defaults.
    return { ...DEFAULTS };
  }
}

export function writeSettings(patch: Partial<AppSettings>): AppSettings {
  const next = parse({ ...readSettings(), ...patch });
  fs.mkdirSync(PATHS.data, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

/**
 * Carrega as settings salvas e segredos em `process.env`.
 *
 * Só sobrescreve quando o `.env` não definiu o valor — assim as chaves
 * coladas no arquivo local continuam prevalecendo em desenvolvimento.
 */
export async function applySettingsToEnv(): Promise<AppSettings> {
  const settings = readSettings();
  const env = process.env;

  // Carrega segredos criptografados
  const secrets = await loadSecrets();
  
  // Configura o provedor ativo
  const activeProvider = settings.aiProvider;
  const secretKey = SECRET_KEYS[activeProvider];
  if (secretKey && secrets[secretKey]) {
    if (!env.AI_API_KEY) env.AI_API_KEY = secrets[secretKey];
  } else if (activeProvider !== 'local' && activeProvider !== 'ollama') {
    // Provedor requer chave mas não tem - limpa env para forçar fallback
    delete env.AI_API_KEY;
  }

  if (settings.aiModel) env.AI_MODEL = settings.aiModel;
  env.AI_PROVIDER = activeProvider;
  
  // Parâmetros extras do provedor
  if (settings.aiProviderParams?.[activeProvider]) {
    for (const [k, v] of Object.entries(settings.aiProviderParams[activeProvider])) {
      const envKey = `AI_${activeProvider.toUpperCase()}_${k.toUpperCase()}`;
      if (!env[envKey]) env[envKey] = String(v);
    }
  }

  // Transcrição
  if (!env.TRANSCRIPTION_API_KEY && secrets.transcription_key) {
    env.TRANSCRIPTION_API_KEY = secrets.transcription_key;
  }
  if (settings.transcriptionModel) env.TRANSCRIPTION_MODEL = settings.transcriptionModel;
  if (settings.transcriptionDevice) env.TRANSCRIPTION_DEVICE = settings.transcriptionDevice;
  if (settings.transcriptionComputeType) env.TRANSCRIPTION_COMPUTE_TYPE = settings.transcriptionComputeType;
  if (settings.transcriptionLanguage) env.TRANSCRIPTION_LANGUAGE = settings.transcriptionLanguage;
  if (settings.transcriptionProvider !== 'auto') {
    env.TRANSCRIPTION_PROVIDER = settings.transcriptionProvider;
  }

  if (settings.maxVideoSizeMb > 0) {
    env.MAX_VIDEO_SIZE_MB = String(settings.maxVideoSizeMb);
  }

  return settings;
}

/** Versão segura para o cliente: nunca devolve as chaves em claro. */
export async function toPublicSettings(settings: AppSettings) {
  const secrets = await loadSecrets();
  
  const mask = (value: string): string => {
    if (!value) return '';
    if (value.length <= 8) return '••••';
    return `${value.slice(0, 4)}••••${value.slice(-4)}`;
  };

  const activeProvider = settings.aiProvider;
  const secretKey = SECRET_KEYS[activeProvider];
  const hasActiveKey = secretKey ? Boolean(secrets[secretKey]) : false;

  return {
    aiProvider: settings.aiProvider,
    aiModel: settings.aiModel,
    aiHasKey: hasActiveKey,
    aiKeyMasked: hasActiveKey ? mask(secrets[secretKey]!) : '',
    aiProviders: Object.entries(AI_PROVIDERS).map(([id, config]) => {
      const key = SECRET_KEYS[id as AiProviderId];
      const hasKey = key ? Boolean(secrets[key]) : !config.requiresKey;
      const keyValue = key ? secrets[key] : undefined;
      return {
        id,
        name: config.name,
        requiresKey: config.requiresKey,
        defaultModel: config.defaultModel,
        models: config.models || [],
        baseUrl: config.baseUrl,
        configured: hasKey,
        keyMasked: hasKey && keyValue ? mask(keyValue) : '',
        currentModel: settings.aiProvider === id ? settings.aiModel : config.defaultModel,
      };
    }),
    aiProviderParams: settings.aiProviderParams || {},
    
    transcriptionProvider: settings.transcriptionProvider,
    transcriptionModel: settings.transcriptionModel,
    transcriptionDevice: settings.transcriptionDevice,
    transcriptionComputeType: settings.transcriptionComputeType,
    transcriptionLanguage: settings.transcriptionLanguage,
    transcriptionHasKey: Boolean(secrets.transcription_key),
    transcriptionKeyMasked: secrets.transcription_key ? mask(secrets.transcription_key) : '',
    
    maxVideoSizeMb: settings.maxVideoSizeMb,
    secureStorageAvailable: await isSecureStorageAvailable(),

    // Parâmetros de análise (P0)
    targetCutSeconds: settings.targetCutSeconds,
    maxCuts: settings.maxCuts,
    overlapThreshold: settings.overlapThreshold,
    minCutDuration: settings.minCutDuration,
    maxCutDuration: settings.maxCutDuration,
  };
}

/**
 * Salva uma API key para um provedor específico.
 */
export async function saveApiKey(providerId: AiProviderId, apiKey: string): Promise<void> {
  const secretKey = SECRET_KEYS[providerId];
  if (!secretKey) {
    throw new Error(`Provedor ${providerId} não suporta API key`);
  }
  const secrets = await loadSecrets();
  secrets[secretKey] = apiKey.trim();
  await saveSecrets(secrets);
  
  // Atualiza env do processo atual
  if (providerId === (readSettings().aiProvider)) {
    process.env.AI_API_KEY = apiKey.trim();
  }
}

/**
 * Remove uma API key.
 */
export async function removeApiKey(providerId: AiProviderId): Promise<void> {
  const secretKey = SECRET_KEYS[providerId];
  if (!secretKey) return;
  const secrets = await loadSecrets();
  delete secrets[secretKey];
  await saveSecrets(secrets);
  
  // Limpa env se era o provedor ativo
  if (providerId === (readSettings().aiProvider)) {
    delete process.env.AI_API_KEY;
  }
}

/**
 * Obtém a API key de um provedor (para uso interno).
 */
export async function getApiKey(providerId: AiProviderId): Promise<string | undefined> {
  const secretKey = SECRET_KEYS[providerId];
  if (!secretKey) return undefined;
  const secrets = await loadSecrets();
  return secrets[secretKey];
}

/**
 * Salva chave de transcrição.
 */
export async function saveTranscriptionKey(apiKey: string): Promise<void> {
  const secrets = await loadSecrets();
  secrets.transcription_key = apiKey.trim();
  await saveSecrets(secrets);
  if (!process.env.TRANSCRIPTION_API_KEY) {
    process.env.TRANSCRIPTION_API_KEY = apiKey.trim();
  }
}

/**
 * Remove chave de transcrição.
 */
export async function removeTranscriptionKey(): Promise<void> {
  const secrets = await loadSecrets();
  delete secrets.transcription_key;
  await saveSecrets(secrets);
  delete process.env.TRANSCRIPTION_API_KEY;
}
