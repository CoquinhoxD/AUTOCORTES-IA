import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  applySettingsToEnv,
  readSettings,
  toPublicSettings,
  writeSettings,
  saveApiKey,
  removeApiKey,
  AI_PROVIDERS,
  type AiProviderId,
  type AppSettings,
} from '../config/settings.js';

const ProviderIdSchema = z.enum(['groq', 'openai', 'gemini', 'ollama', 'local']);

const PatchSchema = z
  .object({
    aiProvider: ProviderIdSchema.optional(),
    aiModel: z.string().min(1).max(200).optional(),
    aiProviderParams: z.record(z.string(), z.record(z.unknown())).optional(),
    transcriptionProvider: z.enum(['auto', 'groq', 'openai', 'mock', 'local']).optional(),
    transcriptionModel: z.string().min(1).max(200).optional(),
    transcriptionDevice: z.enum(['auto', 'cuda', 'cpu']).optional(),
    transcriptionComputeType: z.enum(['auto', 'int8', 'int8_float16', 'float16', 'float32']).optional(),
    transcriptionLanguage: z.string().min(1).max(10).optional(),
    maxVideoSizeMb: z.number().int().min(1).max(102_400).optional(),

    // Parâmetros de análise (P0)
    targetCutSeconds: z.number().int().min(10).max(300).optional(),
    maxCuts: z.number().int().min(1).max(100).optional(),
    overlapThreshold: z.number().min(0).max(1).optional(),
    minCutDuration: z.number().int().min(1).max(60).optional(),
    maxCutDuration: z.number().int().min(10).max(600).optional(),
  })
  .strict();

const SaveKeySchema = z.object({
  provider: ProviderIdSchema,
  apiKey: z.string().min(1).max(500),
});

const TestConnectionSchema = z.object({
  provider: ProviderIdSchema,
  apiKey: z.string().min(1).max(500),
  model: z.string().min(1).max(200).optional(),
  baseUrl: z.string().url().optional(),
});

const OllamaModelsSchema = z.object({
  baseUrl: z.string().url().optional().default('http://localhost:11434'),
});

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/settings - Retorna configuração pública (sem segredos) */
  app.get('/api/settings', async () => toPublicSettings(readSettings()));

  /** PUT /api/settings - Atualiza configurações não-sensíveis */
  app.put('/api/settings', async (request, reply) => {
    const parsed = PatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Configuração inválida.', issues: parsed.error.issues });
    }

    const saved: AppSettings = writeSettings(parsed.data as Partial<AppSettings>);

    // Reflete no processo corrente
    await applySettingsToEnv();

    return toPublicSettings(saved);
  });

  /** POST /api/settings/key - Salva API key para um provedor */
  app.post('/api/settings/key', async (request, reply) => {
    const parsed = SaveKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Dados inválidos.', issues: parsed.error.issues });
    }

    const { provider, apiKey } = parsed.data;
    const config = AI_PROVIDERS[provider];

    if (!config.requiresKey) {
      return reply.code(400).send({ error: `Provedor ${provider} não requer API key.` });
    }

    try {
      await saveApiKey(provider, apiKey);
      await applySettingsToEnv();
      return { ok: true, message: `Chave salva para ${config.name}.` };
    } catch (error) {
      return reply.code(500).send({ error: `Falha ao salvar chave: ${(error as Error).message}` });
    }
  });

  /** DELETE /api/settings/key - Remove API key de um provedor */
  app.delete('/api/settings/key', async (request, reply) => {
    const { provider } = request.query as { provider?: string };
    if (!provider || !ProviderIdSchema.safeParse(provider).success) {
      return reply.code(400).send({ error: 'Provedor inválido.' });
    }

    try {
      await removeApiKey(provider as AiProviderId);
      await applySettingsToEnv();
      return { ok: true, message: `Chave removida para ${provider}.` };
    } catch (error) {
      return reply.code(500).send({ error: `Falha ao remover chave: ${(error as Error).message}` });
    }
  });

  /** POST /api/settings/test - Testa conexão com um provedor (sem salvar) */
  app.post('/api/settings/test', async (request, reply) => {
    const parsed = TestConnectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Dados inválidos.', issues: parsed.error.issues });
    }

    const { provider, apiKey, model, baseUrl } = parsed.data;
    const config = AI_PROVIDERS[provider];

    if (provider === 'local') {
      return { ok: true, message: 'Gerador local sempre disponível (sem API key).' };
    }

    if (provider === 'ollama') {
      const url = baseUrl || config.baseUrl || 'http://localhost:11434';
      try {
        const response = await fetch(`${url.replace('/v1/chat/completions', '')}/api/tags`, {
          method: 'GET',
        });
        if (!response.ok) {
          return { ok: false, message: `Ollama não respondeu em ${url}. Verifique se está rodando.` };
        }
        const data = await response.json() as { models?: Array<{ name: string }> };
        const models = data.models?.map((m) => m.name) || [];
        return { 
          ok: true, 
          message: `Ollama conectado em ${url}. Modelos: ${models.join(', ') || 'nenhum'}`,
          models,
        };
      } catch (error) {
        return { ok: false, message: `Não foi possível conectar ao Ollama em ${url}: ${(error as Error).message}` };
      }
    }

    if (config.requiresKey && !apiKey) {
      return reply.code(400).send({ error: `Chave necessária para ${config.name}.` });
    }

    const testModel = model || config.defaultModel;
    const testUrl = baseUrl || config.baseUrl;
    if (!testUrl) {
      return reply.code(400).send({ error: `URL base não configurada para ${config.name}.` });
    }

    try {
      const response = await fetch(testUrl, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${apiKey}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({
          model: testModel,
          messages: [{ role: 'user', content: 'ok' }],
          max_tokens: 1,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: 'Chave rejeitada pelo provedor (401/403). Verifique a chave.' };
      }
      if (response.status === 429) {
        return { ok: false, message: 'Cota excedida (429). Aguarde ou verifique seu plano.' };
      }
      if (response.status === 404) {
        return { ok: false, message: `Modelo "${testModel}" não encontrado. Verifique o nome.` };
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return { ok: false, message: `Provedor respondeu ${response.status}: ${text.slice(0, 200)}` };
      }
      return { ok: true, message: `Conexão OK com ${config.name} (${testModel}).` };
    } catch (error) {
      const err = error as Error;
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        return { ok: false, message: 'Sem conexão à internet ou provedor inacessível.' };
      }
      if (err.name === 'AbortError') {
        return { ok: false, message: 'Tempo limite excedido.' };
      }
      return { ok: false, message: `Falha: ${err.message}` };
    }
  });

  /** GET /api/settings/models/:provider - Lista modelos disponíveis */
  app.get<{ Params: { provider: string } }>('/api/settings/models/:provider', async (request, reply) => {
    const { provider } = request.params;
    if (!ProviderIdSchema.safeParse(provider).success) {
      return reply.code(400).send({ error: 'Provedor inválido.' });
    }

    const config = AI_PROVIDERS[provider as AiProviderId];

    if (provider === 'ollama') {
      const query = OllamaModelsSchema.safeParse(request.query);
      const baseUrl = query.success ? query.data.baseUrl : 'http://localhost:11434';
      try {
        const response = await fetch(`${baseUrl.replace('/v1/chat/completions', '')}/api/tags`);
        if (!response.ok) {
          return reply.code(502).send({ error: 'Ollama não respondeu.' });
        }
        const data = await response.json() as { models?: Array<{ name: string }> };
        return { models: data.models?.map((m) => m.name) || [], defaultModel: config.defaultModel };
      } catch {
        return reply.code(502).send({ error: 'Não foi possível conectar ao Ollama.' });
      }
    }

    // Para provedores OpenAI-compatíveis, retorna lista estática
    return { models: config.models || [], defaultModel: config.defaultModel };
  });

  /** POST /api/settings/transcription-key - Salva chave de transcrição */
  app.post('/api/settings/transcription-key', async (request, reply) => {
    const { apiKey } = request.body as { apiKey?: string };
    if (!apiKey || typeof apiKey !== 'string') {
      return reply.code(400).send({ error: 'Informe a chave de transcrição.' });
    }

    try {
      // Import dinamico para evitar dependência circular
      const { saveTranscriptionKey, applySettingsToEnv } = await import('../config/settings.js');
      await saveTranscriptionKey(apiKey);
      await applySettingsToEnv();
      return { ok: true, message: 'Chave de transcrição salva.' };
    } catch (error) {
      return reply.code(500).send({ error: `Falha ao salvar: ${(error as Error).message}` });
    }
  });

  /** DELETE /api/settings/transcription-key - Remove chave de transcrição */
  app.delete('/api/settings/transcription-key', async (_request, reply) => {
    try {
      const { removeTranscriptionKey, applySettingsToEnv } = await import('../config/settings.js');
      await removeTranscriptionKey();
      await applySettingsToEnv();
      return { ok: true, message: 'Chave de transcrição removida.' };
    } catch (error) {
      return reply.code(500).send({ error: `Falha ao remover: ${(error as Error).message}` });
    }
  });
}