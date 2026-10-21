import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import fs from 'fs';
import crypto from 'node:crypto';
import path from 'path';
import type { Transcription, TranscriptionProvider } from './transcription.service.js';
import { getTranscriptionProvider } from './transcription.service.js';
import { PATHS } from '../config/paths.js';

const execAsync = promisify(execCallback);

const CHUNK_MAX_SIZE_MB = 24;      // limite da API (Groq: 25MB)
const CHUNK_MAX_DURATION_SEC = 600; // 10 min por chunk
const CHUNK_OVERLAP_SEC = 2;       // evita cortar palavras no meio
/**
 * Fração de sobreposição que caracteriza "mesmo trecho reportado duas vezes".
 * Acima disso funde; segmentos que só se encostam (0% de sobreposição) nunca
 * são fundidos, porque no Whisper isso é a norma e não duplicação.
 */
const CHUNK_OVERLAP_MERGE_RATIO = 0.2;
const CACHE_VERSION = 1;
function cacheLocation(audioPath: string, provider: string): string {
  const st = fs.statSync(audioPath);
  const key = crypto.createHash('sha256').update(JSON.stringify({
    v: CACHE_VERSION, path: path.resolve(audioPath), size: st.size, mtime: st.mtimeMs,
    provider, model: process.env.TRANSCRIPTION_MODEL || '',
  })).digest('hex');
  return path.join(PATHS.temp, 'transcription-cache', `${key}.json`);
}
function readCached(file: string): Transcription | null {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Transcription;
    return Array.isArray(value.segments) && typeof value.fullText === 'string' ? value : null;
  } catch { return null; }
}
function saveCached(file: string, result: Transcription): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(result));
  fs.renameSync(tmp, file);
}


function runFfmpeg(args: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: 'ignore' });
    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(`${label}: ffmpeg não encontrado no PATH.`));
        return;
      }
      reject(err);
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${label} falhou (código ${code})`));
        return;
      }
      resolve();
    });
  });
}

async function getAudioDuration(audioPath: string): Promise<number> {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
  );
  return Number(stdout.trim());
}

async function needsChunking(audioPath: string): Promise<boolean> {
  const sizeMB = fs.statSync(audioPath).size / (1024 * 1024);
  if (sizeMB > CHUNK_MAX_SIZE_MB) return true;
  const duration = await getAudioDuration(audioPath);
  return duration > CHUNK_MAX_DURATION_SEC;
}

async function splitAudioIntoChunks(audioPath: string): Promise<string[]> {
  const totalDuration = await getAudioDuration(audioPath);
  const chunkDuration = Math.min(CHUNK_MAX_DURATION_SEC, totalDuration);
  const step = chunkDuration - CHUNK_OVERLAP_SEC;
  const numChunks = Math.ceil(totalDuration / step);

  const tempDir = path.join(PATHS.temp, `chunks_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const chunkPaths: string[] = [];

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * step;
    const actualDuration = Math.min(chunkDuration, totalDuration - startTime);
    if (actualDuration <= 0) break;

    const chunkPath = path.join(tempDir, `chunk_${String(i).padStart(3, '0')}.mp3`);

    await runFfmpeg(
      [
        '-ss', startTime.toFixed(3),
        '-i', audioPath,
        '-t', actualDuration.toFixed(3),
        '-acodec', 'libmp3lame',
        '-b:a', '32k',
        '-ar', '16000',
        '-ac', '1',
        '-y', chunkPath,
      ],
      `Divisão de áudio (chunk ${i + 1}/${numChunks})`
    );

    chunkPaths.push(chunkPath);
    console.log(`[WHISPER] Chunk ${i + 1}/${numChunks} criado (${actualDuration.toFixed(1)}s)`);
  }

  return chunkPaths;
}

/** Ajusta timestamps dos segmentos somando o offset de início de cada chunk. */
export function mergeChunkTranscriptions(
  results: Transcription[],
  chunkStartTimes: number[]
): Transcription {
  const allSegments: Transcription['segments'] = [];

  for (let i = 0; i < results.length; i++) {
    const offset = chunkStartTimes[i];
    for (const seg of results[i].segments) {
      allSegments.push({
        id: 0,
        start: Number((seg.start + offset).toFixed(3)),
        end: Number((seg.end + offset).toFixed(3)),
        text: seg.text,
      });
    }
  }

  allSegments.sort((a, b) => a.start - b.start);

  // Remove a duplicação da região compartilhada entre chunks consecutivos.
  //
  // O teste precisa ser sobreposição REAL no tempo, não simples adjacency.
  // Segmentos do Whisper são contíguos por natureza (cada um começa onde o
  // anterior termina), então a regra antiga `seg.start <= previous.end + 0.2`
  // encadeava a transcrição inteira num único segmento — num vídeo com 15
  // chunks sobrava 1 segmento e nenhum corte sobrevivia à validação.
  const merged: Transcription['segments'] = [];
  for (const seg of allSegments) {
    const previous = merged[merged.length - 1];

    if (previous) {
      const overlap =
        Math.min(previous.end, seg.end) - Math.max(previous.start, seg.start);
      const shorter = Math.min(
        previous.end - previous.start,
        seg.end - seg.start
      );

      if (shorter > 0 && overlap / shorter >= CHUNK_OVERLAP_MERGE_RATIO) {
        if (seg.text !== previous.text) {
          previous.text = `${previous.text} ${seg.text}`.trim();
        }
        previous.end = Math.max(previous.end, seg.end);
        continue;
      }
    }

    merged.push({ ...seg, id: merged.length });
  }

  return {
    segments: merged,
    fullText: merged.map((s) => s.text).join(' ').trim(),
  };
}

/** Remove arquivos temporários (chunks) sem apagar o vídeo original. */
export function cleanupTempFiles(targetPath?: string): void {
  const pathToClean = targetPath ?? PATHS.temp;

  try {
    if (!fs.existsSync(pathToClean)) return;

    const stat = fs.statSync(pathToClean);

    if (stat.isFile()) {
      fs.rmSync(pathToClean, { force: true });
      console.log(`[CLEANUP] Arquivo temporário removido: ${path.basename(pathToClean)}`);
      return;
    }

    for (const entry of fs.readdirSync(pathToClean)) {
      if (!targetPath && entry === 'transcription-cache') continue;
      fs.rmSync(path.join(pathToClean, entry), { recursive: true, force: true });
    }
    console.log(`[CLEANUP] Temporários removidos de: ${path.basename(pathToClean)}`);
  } catch (error) {
    console.warn(`[CLEANUP] Falha ao limpar ${pathToClean}:`, error);
  }
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

/**
 * Ponto de entrada da transcrição.
 * Divide áudio grande em chunks, transcreve e mescla com timestamps corretos.
 * Emite progresso via callback se fornecido.
 */
export async function transcribe(
  audioPath: string,
  onProgress?: (progress: any) => void
): Promise<Transcription> {
  const provider: TranscriptionProvider = getTranscriptionProvider();

  const cacheFile = cacheLocation(audioPath, provider.constructor.name);
  const cached = readCached(cacheFile);
  if (cached) {
    console.log('[WHISPER] Transcrição reutilizada do cache');
    onProgress?.({ type: 'progress', percent: 100, message: 'Transcrição recuperada do cache', stage: 'complete', timestamp: Date.now(), segments: cached.segments.length });
    return cached;
  }
  const shouldChunk = await needsChunking(audioPath);

  if (!shouldChunk) {
    console.log(`[WHISPER] Transcrição iniciada (arquivo único): ${path.basename(audioPath)}`);
    onProgress?.({ type: 'progress', percent: 10, message: 'Iniciando transcrição...', stage: 'transcribing', timestamp: Date.now() });
    const result = await provider.transcribe(audioPath);
    onProgress?.({ type: 'progress', percent: 90, message: 'Finalizando...', stage: 'finalizing', timestamp: Date.now() });
    saveCached(cacheFile, result);
    console.log(`[WHISPER] Transcrição concluída: ${result.segments.length} segmentos`);
    onProgress?.({ type: 'progress', percent: 100, message: 'Transcrição concluída', stage: 'complete', timestamp: Date.now(), segments: result.segments.length });
    return result;
  }

  console.log('[WHISPER] Arquivo grande detectado — dividindo em chunks');
  onProgress?.({ type: 'progress', percent: 5, message: 'Dividindo áudio em chunks...', stage: 'chunking', timestamp: Date.now() });
  
  const chunkPaths = await splitAudioIntoChunks(audioPath);
  const step = CHUNK_MAX_DURATION_SEC - CHUNK_OVERLAP_SEC;
  const chunkStartTimes = chunkPaths.map((_, i) => i * step);

  const tempDir = path.dirname(chunkPaths[0]);

  try {
    const results: Transcription[] = [];

    onProgress?.({ type: 'progress', percent: 15, message: `Dividido em ${chunkPaths.length} chunks`, stage: 'chunking', timestamp: Date.now(), total_chunks: chunkPaths.length });

    // Concorrência limitada: acelera Groq/OpenAI sem disparar todas as requisições.
    // O provedor local permanece sequencial para evitar disputa por CPU/GPU.
    const requested = Number(process.env.TRANSCRIPTION_CONCURRENCY || '2');
    const concurrency = provider.constructor.name === 'LocalWhisperProvider'
      ? 1
      : Math.max(1, Math.min(3, Number.isFinite(requested) ? Math.floor(requested) : 2));
    const orderedResults: Transcription[] = new Array(chunkPaths.length);
    let nextIndex = 0;
    let completed = 0;
    const worker = async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= chunkPaths.length) return;
        console.log(`[WHISPER] Transcrevendo chunk ${i + 1}/${chunkPaths.length}...`);
        orderedResults[i] = await provider.transcribe(chunkPaths[i]);
        completed++;
        onProgress?.({
          type: 'progress',
          percent: Math.round(20 + (completed / chunkPaths.length) * 75),
          message: `Transcritos ${completed}/${chunkPaths.length} blocos`,
          stage: 'transcribing',
          timestamp: Date.now(),
          current_chunk: completed,
          total_chunks: chunkPaths.length,
          chunk_start: chunkStartTimes[i]
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, chunkPaths.length) }, () => worker()));
    results.push(...orderedResults);

    const merged = mergeChunkTranscriptions(results, chunkStartTimes);
    saveCached(cacheFile, merged);
    console.log(`[WHISPER] Transcrição concluída: ${merged.segments.length} segmentos mesclados`);
    onProgress?.({ type: 'progress', percent: 100, message: 'Transcrição concluída', stage: 'complete', timestamp: Date.now(), segments: merged.segments.length });
    return merged;
  } finally {
    cleanupTempFiles(tempDir);
  }
}