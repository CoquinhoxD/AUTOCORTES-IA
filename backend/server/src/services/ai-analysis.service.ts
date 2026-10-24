import { AIAnalysisSchema, type AIAnalysis, type AICut, flattenCutScores } from './ai-analysis.schema.js';
import { MIN_CUT_DURATION, MAX_CUT_DURATION } from './cut-validator.service.js';
import { withRateLimitRetry } from './http-retry.js';
import { CUT_ANALYSIS_SYSTEM_PROMPT, FIX_JSON_PROMPT } from '../prompts/cut-analysis.prompt.js';
import { readSettings, getApiKey, AI_PROVIDERS } from '../config/settings.js';

/** Duração preferida de um corte gerado localmente. */
const TARGET_CUT_SECONDS = 45;
/** Teto de cortes do gerador local — o mesmo limite do prompt da IA real. */
const MAX_MOCK_CUTS = 20;

export class AiAnalysisError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly rawResponse?: string
  ) {
    super(message);
    this.name = 'AiAnalysisError';
  }
}

export class AiNotConfiguredError extends Error {
  constructor(message = 'Configure sua API de IA para realizar a análise.') {
    super(message);
    this.name = 'AiNotConfiguredError';
  }
}

interface AiProvider {
  call(systemPrompt: string, userPrompt: string): Promise<string>;
}

// Test-only injection point. Production always resolves the configured provider.
let providerOverride: AiProvider | null = null;
export function setAiProvider(provider: AiProvider | null): void {
  providerOverride = provider;
}

/**
 * Provider OpenAI-compatible (Groq, OpenAI, Together, OpenRouter, Ollama, etc).
 */
export class OpenAICompatibleProvider implements AiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string
  ) {}

  async call(systemPrompt: string, userPrompt: string): Promise<string> {
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    });

    return withRateLimitRetry(
      () =>
        fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
        }),
      async (response) => {
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          error?: { message?: string; code?: string };
        };

        if (data.error) {
          throw new Error(`${data.error.code || 'API_ERROR'}: ${data.error.message}`);
        }

        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error('AI provider returned empty content');
        }

        return content;
      },
      { label: 'AI provider' }
    );
  }
}

/**
 * Provider para Google Gemini (usa API nativa, não OpenAI-compatível).
 */
export class GeminiProvider implements AiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  async call(systemPrompt: string, userPrompt: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    
    const body = JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'user', parts: [{ text: userPrompt }] },
      ],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json',
      },
    });

    return withRateLimitRetry(
      () =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }),
      async (response) => {
        const data = (await response.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          error?: { message?: string; code?: number };
        };

        if (data.error) {
          throw new Error(`GEMINI_${data.error.code}: ${data.error.message}`);
        }

        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!content) {
          throw new Error('Gemini returned empty content');
        }

        return content;
      },
      { label: 'Gemini' }
    );
  }
}

/**
 * Provider para Ollama local.
 */
export class OllamaProvider implements AiProvider {
  constructor(
    private readonly model: string,
    private readonly baseUrl: string = 'http://localhost:11434/v1/chat/completions'
  ) {}

  async call(systemPrompt: string, userPrompt: string): Promise<string> {
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      format: 'json',
      stream: false,
    });

    return withRateLimitRetry(
      () =>
        fetch(this.baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }),
      async (response) => {
        const data = (await response.json()) as {
          message?: { content?: string };
          error?: string;
        };

        if (data.error) {
          throw new Error(`OLLAMA: ${data.error}`);
        }

        const content = data.message?.content;
        if (!content) {
          throw new Error('Ollama returned empty content');
        }

        return content;
      },
      { label: 'Ollama' }
    );
  }
}

/**
 * Remove cercas de código Markdown e localiza o objeto JSON.
 */
export function extractJson(raw: string): string {
  let text = raw.trim();

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Nenhum objeto JSON encontrado na resposta da IA');
  }

  return text.slice(firstBrace, lastBrace + 1);
}

/**
 * Fábrica de provedores de IA baseada nas configurações salvas.
 */
export async function createAiProvider(): Promise<AiProvider> {
  const settings = readSettings();
  const providerId = settings.aiProvider;
  const config = AI_PROVIDERS[providerId];
  
  // Parâmetros extras do provedor
  const extraParams = settings.aiProviderParams?.[providerId] || {};

  if (providerId === 'local') {
    console.log('[AI] Usando gerador local (heurístico)');
    return new LocalMockAiProvider();
  }

  if (providerId === 'ollama') {
    const baseUrl = (extraParams.baseUrl as string) || config.baseUrl || 'http://localhost:11434/v1/chat/completions';
    console.log(`[AI] Provider: Ollama | modelo: ${settings.aiModel} | url: ${baseUrl}`);
    return new OllamaProvider(settings.aiModel, baseUrl);
  }

  // Provedores que requerem API key
  const apiKey = await getApiKey(providerId);
  if (!apiKey) {
    console.warn(`[AI] Chave não configurada para ${config.name} — usando gerador local`);
    return new LocalMockAiProvider();
  }

  const model = settings.aiModel || config.defaultModel;
  const baseUrl = (extraParams.baseUrl as string) || config.baseUrl || '';

  if (providerId === 'gemini') {
    console.log(`[AI] Provider: Gemini | modelo: ${model}`);
    return new GeminiProvider(apiKey, model);
  }

  // OpenAI-compatíveis (Groq, OpenAI, Together, OpenRouter, etc)
  console.log(`[AI] Provider: ${config.name} | modelo: ${model} | url: ${baseUrl}`);
  return new OpenAICompatibleProvider(apiKey, model, baseUrl);
}

/**
 * Gerador local de cortes — usado quando não há API key configurada.
 * Produz JSON válido no mesmo formato do provedor real (validado pelo Zod),
 * com timestamps derivados da duração real do vídeo (sem alucinação).
 */
export class LocalMockAiProvider implements AiProvider {
  async call(_systemPrompt: string, userPrompt: string): Promise<string> {
    const durationMatch = userPrompt.match(/DURAÇÃO DO VÍDEO:\s*([\d.]+)/i);
    const duration = durationMatch ? Number(durationMatch[1]) : 60;

    // Segmentos disponíveis vêm da transcrição — recortes reais, não inventados.
    const marks = [...userPrompt.matchAll(/\[(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\]/g)].map((m) => ({
      start: Number(m[1]),
      end: Number(m[2]),
    }));

    const cuts = [];
    if (marks.length === 0) {
      // Sem segmentos: um corte único cobrindo o vídeo inteiro.
      if (duration >= MIN_CUT_DURATION) {
        cuts.push(this.buildCut(1, 0, duration, 'Vídeo completo', 'Conteúdo integral do vídeo.'));
      }
    } else {
      this.buildWindows(marks, duration).forEach((cut, index) => {
        cuts.push(this.buildCut(index + 1, cut.start, cut.end, cut.theme, cut.subject));
      });
    }

    return JSON.stringify({
      cuts,
      controversies: [],
      top5: cuts.slice(0, 5).map((c) => c.rank),
    });
  }

  /**
   * Monta janelas de ~TARGET_CUT_SECONDS alinhadas aos segmentos da transcrição.
   */
  private buildWindows(
    marks: Array<{ start: number; end: number }>,
    duration: number
  ): Array<{ start: number; end: number; theme: string; subject: string }> {
    const windows: Array<{ start: number; end: number; theme: string; subject: string }> = [];

    const howMany = Math.max(
      1,
      Math.min(MAX_MOCK_CUTS, Math.floor(duration / TARGET_CUT_SECONDS))
    );
    const stride = duration / howMany;

    let searchFrom = 0;

    for (let k = 0; k < howMany && windows.length < MAX_MOCK_CUTS; k++) {
      const desiredStart = k * stride;

      // Alinha no segmento real mais próximo do início desejado.
      let index = searchFrom;
      while (index < marks.length && marks[index].end < desiredStart) index++;
      if (index >= marks.length) break;

      const start = marks[index].start;
      let end = start;
      let j = index;

      while (j < marks.length && end - start < TARGET_CUT_SECONDS) {
        end = Math.min(marks[j].end, duration);
        j++;
        if (end - start >= MAX_CUT_DURATION) break;
      }

      const span = end - start;
      if (span >= MIN_CUT_DURATION && span <= MAX_CUT_DURATION && start < duration) {
        windows.push({
          start: Number(start.toFixed(2)),
          end: Number(end.toFixed(2)),
          theme: `Bloco ${windows.length + 1} (${start.toFixed(0)}s–${end.toFixed(0)}s)`,
          subject: `Trecho ${windows.length + 1} da transcrição.`,
        });
        searchFrom = j;
      } else {
        searchFrom = index + 1;
        if (searchFrom >= marks.length) break;
      }
    }

    return windows;
  }

  private buildCut(
    rank: number,
    startTime: number,
    endTime: number,
    theme: string,
    subject: string
  ) {
    const span = endTime - startTime;
    const base = Math.min(99, Math.round(60 + span * 0.4));
    return {
      rank,
      theme,
      startTime: Number(startTime.toFixed(2)),
      endTime: Number(endTime.toFixed(2)),
      duration: Number(span.toFixed(2)),
      subject,
      whyViral: 'Trecho com gancho claro e resolução dentro do bloco.',
      hook: `Abertura de "${theme}".`,
      strongestMoment: `Pico entre ${startTime.toFixed(0)}s e ${endTime.toFixed(0)}s.`,
      conclusion: `Fecha naturalmente em ${endTime.toFixed(0)}s.`,
      retentionScore: base,
      commentsScore: Math.max(1, base - 5),
      sharesScore: Math.max(1, base - 10),
      controversyScore: Math.max(1, base - 15),
      curiosityScore: Math.min(99, base + 5),
      emotionScore: Math.max(1, base - 8),
      replayScore: Math.max(1, base - 12),
      viralPotential: base,
      headline: `${theme} — o melhor do vídeo`,
      alternativeHeadline: `${subject} em ${span.toFixed(0)}s`,
    };
  }
}

/**
 * Uma chamada ao provedor + parse tolerante com uma tentativa de reparo.
 */
async function callAndParse(
  provider: AiProvider,
  systemPrompt: string,
  userPrompt: string
): Promise<AIAnalysis> {
  let raw = await provider.call(systemPrompt, userPrompt);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = AIAnalysisSchema.safeParse(JSON.parse(extractJson(raw)));
      if (parsed.success) return parsed.data;

      console.error(`[AI] JSON inválido (tentativa ${attempt}):`, parsed.error.issues.slice(0, 5));
    } catch (error) {
      console.error(`[AI] Falha ao parsear resposta (tentativa ${attempt}):`, error);
    }

    if (attempt === 2) break;

    console.log('[AI] Tentando corrigir: segunda chamada pedindo JSON válido');
    raw = await provider.call(systemPrompt, `${userPrompt}\n\n${FIX_JSON_PROMPT}`);
  }

  throw new AiAnalysisError(
    'A IA não retornou JSON válido após 2 tentativas. Nenhum corte foi salvo.',
    2,
    raw?.slice(0, 500)
  );
}

/** Renumera os candidatos na ordem recebida e remove ranks repetidos. */
function renumber(cuts: AICut[]): AICut[] {
  return cuts.map((cut, index) => ({ ...cut, rank: index + 1 }));
}

/**
 * Analisa a transcrição e retorna JSON estruturado validado com Zod.
 */
export async function analyzeWithAi(options: AnalyzeOptions): Promise<AIAnalysis> {
  const provider = providerOverride ?? await createAiProvider();
  const isLocal = provider instanceof LocalMockAiProvider;

  const estimated = estimateTokens(buildUserPrompt(options));
  const batches =
    !isLocal && estimated > MAP_INPUT_TOKEN_BUDGET
      ? splitSegmentsIntoBatches(options.segments)
      : [options.segments];

  // Não descarte silenciosamente o final do conteúdo em vídeos longos.
  if (batches.length > MAX_BATCHES) {
    throw new AiAnalysisError(
      `Transcrição extensa demais para análise segura (${batches.length} blocos; limite ${MAX_BATCHES}). Divida o vídeo em partes menores.`,
      0
    );
  }

  if (batches.length <= 1) {
    console.log(`[AI] Análise iniciada (1 requisição, ~${estimated} tokens)`);
    return callAndParse(provider, CUT_ANALYSIS_SYSTEM_PROMPT, buildUserPrompt(options));
  }

  console.log(
    `[AI] Transcrição de ~${estimated} tokens excede o limite por requisição — ` +
      `dividindo em ${batches.length} blocos`
  );

  const collected: AICut[] = [];
  const controversies: string[] = [];

  for (let i = 0; i < batches.length; i++) {
    const prompt = buildMapPrompt(options, batches[i], i, batches.length);
    console.log(`[AI] Bloco ${i + 1}/${batches.length}...`);

    try {
      const partial = await callAndParse(provider, CUT_ANALYSIS_SYSTEM_PROMPT, prompt);
      collected.push(...partial.cuts);
      controversies.push(...partial.controversies);
    } catch (error) {
      console.error(`[AI] Bloco ${i + 1} falhou, seguindo sem ele:`, error);
    }
  }

  if (collected.length === 0) {
    throw new AiAnalysisError('Nenhum bloco da transcrição produziu candidatos.', batches.length);
  }

  console.log(`[AI] ${collected.length} candidatos coletados — ranqueando globalmente`);

  try {
    const reduced = await callAndParse(
      provider,
      REDUCE_SYSTEM_PROMPT,
      buildReducePrompt(options.videoDuration, collected, batches.length)
    );

    if (reduced.cuts.length > 0) {
      return {
        ...reduced,
        cuts: renumber(reduced.cuts),
        controversies: [...new Set([...reduced.controversies, ...controversies])],
      };
    }
  } catch (error) {
    console.warn('[AI] Ranqueamento global falhou, usando os candidatos dos blocos:', error);
  }

  return {
    cuts: renumber(collected),
    controversies: [...new Set(controversies)],
    top5: [],
  };
}

/* ------------------------------------------------------------------ */
/* Map-reduce                                                          */
/*                                                                     */
/* Mandar a transcrição inteira numa requisição só não funciona em    */
/* vídeo longo: uma live de 2h22 vira ~72k tokens e o plano gratuito */
/* do Groq aceita 8k por minuto. A resposta é HTTP 413 e o job morre.*/
/*                                                                     */
/* A solução é analisar a transcrição em blocos (map), juntar os      */
/* candidatos e pedir um ranking global (reduce).                     */
/* ------------------------------------------------------------------ */

/** Estimativa grossa de tokens — ~3,5 caracteres por token em pt/en. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Tokens de transcrição por requisição. O prompt de sistema já consome
 * ~1.2k e a resposta dos cortes mais ~600, então 3.2k de transcrição mantém
 * o total perto de 5k — folgado dentro dos 8k/min do plano gratuito.
 */
const MAP_INPUT_TOKEN_BUDGET = 3_200;
const MAP_MAX_CUTS_PER_BATCH = 4;
/** Teto de blocos — evita custo descontrolado em vídeo de dezenas de horas. */
const MAX_BATCHES = 40;

type Segment = AnalyzeOptions['segments'][number];

/**
 * Agrupa segmentos em blocos que cabem no orçamento de tokens.
 * Nunca quebra um segmento no meio e nunca descarta o início da transcrição.
 */
export function splitSegmentsIntoBatches(
  segments: Segment[],
  budget: number = MAP_INPUT_TOKEN_BUDGET
): Segment[][] {
  const batches: Segment[][] = [];
  let current: Segment[] = [];
  let used = 0;

  for (const seg of segments) {
    const line = `[${seg.start.toFixed(2)}-${seg.end.toFixed(2)}] ${seg.text}`;
    const cost = estimateTokens(line) + 1;

    if (current.length > 0 && used + cost > budget) {
      batches.push(current);
      current = [];
      used = 0;
    }

    current.push(seg);
    used += cost;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

/** Prompt de um bloco. Os timestamps são absolutos — não há ajuste de offset. */
function buildMapPrompt(
  options: AnalyzeOptions,
  batch: Segment[],
  index: number,
  total: number
): string {
  const from = batch[0].start.toFixed(2);
  const to = batch[batch.length - 1].end.toFixed(2);

  return [
    `DURAÇÃO DO VÍDEO: ${options.videoDuration.toFixed(2)} segundos.`,
    `Todo startTime e endTime deve estar entre 0 e ${options.videoDuration.toFixed(2)}.`,
    '',
    `Este é o BLOCO ${index + 1} de ${total} da transcrição, cobrindo ${from}s até ${to}s.`,
    'Analise SOMENTE o conteúdo deste bloco e escolha os melhores cortes dentro dele.',
    '',
    `TRANSCRIÇÃO COM TIMESTAMPS (formato: [inicio-fim] texto):`,
    '',
    batch.map((seg) => `[${seg.start.toFixed(2)}-${seg.end.toFixed(2)}] ${seg.text}`).join('\n'),
    '',
    `Retorne até ${MAP_MAX_CUTS_PER_BATCH} cortes deste bloco, no formato JSON do sistema.`,
  ].join('\n');
}

/** Candidatos em formato compacto, para o reduce não estourar o contexto. */
const REDUCE_SYSTEM_PROMPT = `Você é um editor profissional especialista em cortes virais.

Você receberá uma lista de CANDIDATOS já extraídos de blocos de um vídeo.
Escolha os até 20 melhores, remova repetidos e sobrepostos, e devolva o JSON final.

REGRAS:
- Use apenas os candidatos fornecidos. NÃO invente nem ajuste timestamps.
- endTime deve ser > startTime e <= a duração do vídeo informada.
- duration DEVE ser exatamente endTime - startTime.
- Cada corte precisa fazer sentido sozinho e ser compreensível.

FORMATO DE RESPOSTA (JSON puro, sem Markdown):
{"cuts":[{"rank":1,"theme":"","startTime":0.0,"endTime":45.0,"duration":45.0,
"subject":"","whyViral":"","hook":"","strongestMoment":"","conclusion":"",
"scores":{"retention":0,"comments":0,"shares":0,"controversy":0,"curiosity":0,
"emotion":0,"replay":0,"viralPotential":0},"headline":"","alternativeHeadline":""}],
"controversies":[],"top5":[1,2,3,4,5]}`;

function buildReducePrompt(
  videoDuration: number,
  cuts: AICut[],
  totalBatches: number
): string {
  const lines = cuts.map((cut) => {
    const scores = flattenCutScores(cut);
    return (
      `[${Number(cut.startTime).toFixed(1)}-${Number(cut.endTime).toFixed(1)}] ` +
      `${cut.theme} (viral ${scores.viralPotential}, retencao ${scores.retentionScore})`
    );
  });

  return [
    `DURAÇÃO DO VÍDEO: ${videoDuration.toFixed(2)} segundos.`,
    `Candidatos extraídos de ${totalBatches} bloco(s) da transcrição:`,
    '',
    lines.join('\n'),
    '',
    `Escolha os até 20 melhores, sem repetição e sem sobreposição.`,
  ].join('\n');
}

export interface AnalyzeOptions {
  /** Transcrição completa em texto. */
  fullText: string;
  /** Segmentos com timestamps. */
  segments: Array<{ id: number; start: number; end: number; text: string }>;
  /** Duração real do vídeo. */
  videoDuration: number;
  /** Idioma esperado. */
  language?: string;
}

function buildUserPrompt(options: AnalyzeOptions): string {
  const header = [
    `DURAÇÃO DO VÍDEO: ${options.videoDuration.toFixed(2)} segundos.`,
    `Todo startTime e endTime deve estar entre 0 e ${options.videoDuration.toFixed(2)}.`,
    '',
    `TRANSCRIÇÃO COM TIMESTAMPS (formato: [inicio-fim] texto):`,
    '',
  ].join('\n');

  const body = options.segments
    .map((seg) => `[${seg.start.toFixed(2)}-${seg.end.toFixed(2)}] ${seg.text}`)
    .join('\n');

  return `${header}${body}\n\nAnalise toda a transcrição acima e retorne o JSON com os melhores cortes.`;
}
