import { spawn } from 'child_process';
import path from 'node:path';
import { withRateLimitRetry } from './http-retry.js';
import { PATHS } from '../config/paths.js';
import { readSettings } from '../config/settings.js';

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface Transcription {
  segments: TranscriptSegment[];
  fullText: string;
}

export interface TranscriptionProvider {
  transcribe(audioPath: string): Promise<Transcription>;
}

export interface TranscriptionProgress {
  type: 'progress';
  percent: number;
  message: string;
  timestamp: number;
  stage?: string;
  current_chunk?: number;
  total_chunks?: number;
  total_duration?: number;
  segments?: number;
  duration?: number;
  chunk_start?: number;
  language?: string;
  language_probability?: number;
}

/** Lê configurações de transcrição em tempo de execução. */
function getTranscriptionConfig() {
  const settings = readSettings();
  return {
    model: settings.transcriptionModel || 'small',
    language: 'pt',
    device: 'auto',
    computeType: 'auto',
  };
}

/** Normaliza resposta de APIs de transcrição para o formato interno. */
export function mapProviderResponse(data: {
  text?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
}): Transcription {
  const segments: TranscriptSegment[] = (data.segments ?? [])
    .map((seg, idx) => ({
      id: idx,
      start: Number(seg.start),
      end: Number(seg.end),
      text: String(seg.text ?? '').trim(),
    }))
    .filter((seg) => Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.text.length > 0);

  return {
    segments,
    fullText: data.text ?? segments.map((s) => s.text).join(' '),
  };
}

/** Monta o multipart do upload de áudio — precisa ser refeito a cada tentativa. */
function buildAudioForm(
  fileBuffer: Buffer,
  filename: string,
  model: string
): FormData {
  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer], { type: 'audio/mpeg' }), filename);
  formData.append('model', model);
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');
  return formData;
}

/**
 * Envia um chunk de áudio e normaliza a resposta.
 *
 * O retry é obrigatório no plano gratuito: o Whisper do Groq limita a 7.200
 * segundos de áudio por hora, e uma live de 2h22 tem 8.545. Sem esperar o
 * `retry-after`, o job morre no meio do processamento.
 */
async function postAudio(
  url: string,
  apiKey: string,
  audioPath: string,
  model: string,
  label: string
): Promise<Transcription> {
  const fs = await import('fs');
  const path = await import('path');

  const fileBuffer = fs.readFileSync(audioPath);
  const filename = path.basename(audioPath);

  const json = await withRateLimitRetry(
    () =>
      fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: buildAudioForm(fileBuffer, filename, model),
      }),
    (response) => response.json(),
    { label }
  );

  return mapProviderResponse(
    json as { text?: string; segments?: Array<{ start: number; end: number; text: string }> }
  );
}

export class GroqWhisperProvider implements TranscriptionProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = 'whisper-large-v3-turbo'
  ) {}

  transcribe(audioPath: string): Promise<Transcription> {
    return postAudio(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      this.apiKey,
      audioPath,
      this.model,
      'Groq Whisper'
    );
  }
}

export class OpenAIWhisperProvider implements TranscriptionProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = 'whisper-large-v3'
  ) {}

  transcribe(audioPath: string): Promise<Transcription> {
    return postAudio(
      'https://api.openai.com/v1/audio/transcriptions',
      this.apiKey,
      audioPath,
      this.model,
      'OpenAI Whisper'
    );
  }
}

/** Provedor local: usa faster-whisper via script Python com progresso. */
export class LocalWhisperProvider implements TranscriptionProvider {
  async transcribe(audioPath: string): Promise<Transcription> {
    const scriptPath = path.join(PATHS.backend, 'scripts', 'transcribe_faster_whisper.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const config = getTranscriptionConfig();

    console.log(`[WHISPER] Iniciando transcrição local (faster-whisper): ${audioPath}`);
    console.log(`[WHISPER] Config: model=${config.model}, device=${config.device}, compute_type=${config.computeType}`);

    return new Promise((resolve, reject) => {
      const args = [
        scriptPath,
        'transcribe',
        audioPath,
        config.model,
        config.language,
        config.device,
        config.computeType,
      ];

      const proc = spawn(pythonCmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });

      let stderr = '';

      proc.stdout.on('data', (chunk) => {
        const lines = chunk.toString().trim().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const data = JSON.parse(line);
            if (data.type === 'progress') {
              console.log(`[WHISPER] Progresso: ${data.percent}% - ${data.message}`, data);
            } else {
              // Resultado final
              if (data.segments) {
                console.log(`[WHISPER] Transcrição local concluída: ${data.segments?.length ?? 0} segmentos`);
                resolve({
                  segments: data.segments.map((seg: any, idx: number) => ({
                    id: idx,
                    start: Number(seg.start),
                    end: Number(seg.end),
                    text: String(seg.text ?? '').trim(),
                  })).filter((seg: any) => Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.text.length > 0),
                  fullText: data.fullText ?? data.segments.map((s: any) => s.text).join(' '),
                });
                return;
              }
              if (data.error) {
                reject(new Error(data.error));
                return;
              }
            }
          } catch (e) {
            // Linha não é JSON, pode ser log do Python
            if (line.includes('[faster-whisper]')) {
              console.log(line.trim());
            }
          }
        }
      });

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        // Log progress do Python no console do backend
        if (text.includes('[faster-whisper]')) {
          console.log(text.trim());
        }
      });

      proc.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(
            `Python não encontrado. Instale Python 3.10+ e faster-whisper (pip install faster-whisper).`
          ));
        } else {
          reject(err);
        }
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          const errorMsg = stderr.trim() || `Processo Python saiu com código ${code}`;
          console.error('[WHISPER] Erro na transcrição local:', errorMsg);
          reject(new Error(`Transcrição local falhou: ${errorMsg}`));
          return;
        }
      });
    });
  }
}

/** Cadência dos segmentos sintéticos, em segundos. */
const MOCK_SEGMENT_SECONDS = 8;

/** Falas sintéticas — variar por índice evita que o merge de chunks colapse tudo. */
const MOCK_LINES = [
  'Isso aqui é o ponto principal do assunto.',
  'Deixa eu explicar o que aconteceu na sequência.',
  'A reação do público foi bem mais forte do que eu esperava.',
  'Tem um detalhe que quase todo mundo deixa passar.',
  'E aí vem a parte que muda tudo.',
  'Ninguém acreditou no que eu falei logo depois disso.',
  'Olha só a diferença entre o antes e o depois.',
  'Se você parar pra pensar, faz bastante sentido.',
  'Foi aqui que eu entendi o que realmente importava.',
  'Esse é o tipo de detalhe que passa despercebido.',
  'Aí a conversa mudou de assunto completamente.',
  'E o melhor ainda estava por vir.',
] as const;

/**
 * Provedor mock: gera transcrição sintética para o app funcionar sem API.
 */
export class MockTranscriptionProvider implements TranscriptionProvider {
  async transcribe(audioPath: string): Promise<Transcription> {
    const duration = await this.probeDuration(audioPath);

    console.log(
      `[WHISPER] Usando mock provider — transcrição SINTÉTICA de ${duration.toFixed(1)}s ` +
        '(configure uma chave em Configurações para cortes reais)'
    );

    const segments: TranscriptSegment[] = [];
    let index = 0;

    for (let start = 0; start < duration && segments.length < 2000; start += MOCK_SEGMENT_SECONDS) {
      const end = Math.min(start + MOCK_SEGMENT_SECONDS, duration);
      if (end - start < 0.05) break;

      segments.push({
        id: index,
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
        text: `${MOCK_LINES[index % MOCK_LINES.length]} (${index + 1})`,
      });
      index++;
    }

    return {
      segments,
      fullText: segments.map((s) => s.text).join(' '),
    };
  }

  /** Duração real do arquivo — nunca inventa, é o ffprobe que responde. */
  private async probeDuration(audioPath: string): Promise<number> {
    try {
      const { ffprobe } = await import('./ffmpeg.service.js');
      const probe = await ffprobe(audioPath);
      const seconds = Number(probe.format?.duration ?? 0);
      if (Number.isFinite(seconds) && seconds > 0) return seconds;
    } catch (error) {
      console.warn('[WHISPER] mock: não foi possível ler a duração, usando 60s.', error);
    }
    return 60;
  }
}

export type ProviderName = 'groq' | 'openai' | 'local' | 'mock';

/**
 * Qual provider será realmente usado agora.
 */
export function describeTranscriptionProvider(): ProviderName {
  const configured = process.env.TRANSCRIPTION_PROVIDER?.toLowerCase();
  const key = process.env.TRANSCRIPTION_API_KEY?.trim();

  if (configured === 'mock') return 'mock';
  if (configured === 'local') return 'local';
  if (configured === 'openai') return key ? 'openai' : 'mock';
  if (configured === 'groq') return key ? 'groq' : 'mock';

  if (key?.startsWith('gsk_')) return 'groq';
  if (key?.startsWith('sk-')) return 'openai';
  return 'mock';
}

export function getTranscriptionProvider(): TranscriptionProvider {
  const configured = process.env.TRANSCRIPTION_PROVIDER?.toLowerCase();
  const key = process.env.TRANSCRIPTION_API_KEY?.trim();

  if (configured === 'mock') {
    console.log('[WHISPER] Provider: mock');
    return new MockTranscriptionProvider();
  }

  if (configured === 'local') return new LocalWhisperProvider();

  if (configured === 'openai') {
    if (!key) throw new Error('TRANSCRIPTION_API_KEY não configurada para o provider openai.');
    return new OpenAIWhisperProvider(key, process.env.TRANSCRIPTION_MODEL && process.env.TRANSCRIPTION_MODEL !== 'small' ? process.env.TRANSCRIPTION_MODEL : 'whisper-1');
  }

  if (configured === 'groq') {
    if (!key) throw new Error('TRANSCRIPTION_API_KEY não configurada para o provider groq.');
    return new GroqWhisperProvider(key, process.env.TRANSCRIPTION_MODEL && process.env.TRANSCRIPTION_MODEL !== 'small' ? process.env.TRANSCRIPTION_MODEL : 'whisper-large-v3-turbo');
  }

  // Inferência automática pelo formato da chave
  if (key?.startsWith('gsk_')) {
    console.log('[WHISPER] Provider inferido: groq');
    return new GroqWhisperProvider(key);
  }

  if (key?.startsWith('sk-')) {
    console.log('[WHISPER] Provider inferido: openai');
    return new OpenAIWhisperProvider(key);
  }

  // Fallback: sem provider configurado, usa mock para o fluxo nunca quebrar.
  // Para produção, defina TRANSCRIPTION_PROVIDER=groq|openai e a API key.
  console.warn('[WHISPER] Nenhum provider configurado — usando mock. Defina TRANSCRIPTION_PROVIDER no .env.');
  return new MockTranscriptionProvider();
}

export function isTranscriptionConfigured(): boolean {
  const provider = process.env.TRANSCRIPTION_PROVIDER?.toLowerCase();
  if (provider === 'local' || provider === 'mock') return true;
  const key = process.env.TRANSCRIPTION_API_KEY?.trim() ?? '';
  return key.length > 10 && !key.includes('provide-key');
}