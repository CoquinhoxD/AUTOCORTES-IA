import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { FastifyInstance } from 'fastify';
import { PATHS } from '../config/paths.js';
import { prisma } from '../lib/prisma.js';
import { getVideoTechnicalInfo, ffmpegExtractAudio } from '../services/ffmpeg.service.js';
import { transcribe, cleanupTempFiles } from '../services/transcription-pipeline.service.js';
import { describeTranscriptionProvider } from '../services/transcription.service.js';
import { readSettings, getApiKey, AI_PROVIDERS, type AiProviderId } from '../config/settings.js';

import { normalizeTranscription } from '../services/transcript-normalizer.service.js';
import {
  analyzeWithAi,
  AiNotConfiguredError,
  AiAnalysisError,
} from '../services/ai-analysis.service.js';
import { validateCuts } from '../services/cut-validator.service.js';
import { InMemoryJobQueue } from '../jobs/job-queue.js';
import { PrismaJobRepository } from '../jobs/job-repository.js';
import type { VideoJobStatus } from '../types/job.js';
import { getStepDefinition } from '../types/job.js';

const DEFAULT_MAX_CUTS = 20;

const ALLOWED_MIME = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/x-m4v',
  'video/mpeg',
]);

const ALLOWED_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v']);

export function isAllowedVideo(mimeType: string, filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_MIME.has(mimeType) || ALLOWED_EXT.has(ext);
}

const jobRepository = new PrismaJobRepository(prisma);
const jobQueue = new InMemoryJobQueue(jobRepository);

async function updateVideoStatus(videoId: string, status: VideoJobStatus): Promise<void> {
  await prisma.video.update({ where: { id: videoId }, data: { status } });
}

async function updateJob(videoId: string, status: VideoJobStatus, error?: string): Promise<void> {
  const step = getStepDefinition(status);
  await prisma.job.update({
    where: { videoId },
    data: {
      status,
      progress: step.progress,
      currentStep: status,
      ...(error !== undefined ? { error } : {}),
    },
  });
}

/**
 * Pipeline completo de processamento. Roda fora do ciclo da requisição HTTP.
 */
async function processVideoPipeline(videoId: string): Promise<void> {
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) throw new Error(`Video ${videoId} não encontrado`);

  const audioPath = path.join(PATHS.audio, `${videoId}.mp3`);

  try {
    // 1. Metadados já obtidos no upload — registra para histórico
    console.log(`[VIDEO] Processando ${video.originalName} (${video.duration}s)`);
    await updateJob(videoId, 'PROCESSING_VIDEO');
    await updateVideoStatus(videoId, 'PROCESSING_VIDEO');

    // 2. Extração de áudio
    console.log('[FFMPEG] Extraindo áudio...');
    await updateJob(videoId, 'EXTRACTING_AUDIO');
    await updateVideoStatus(videoId, 'EXTRACTING_AUDIO');
    await ffmpegExtractAudio(video.filePath, audioPath);
    console.log('[FFMPEG] Áudio extraído');

    // 3. Transcrição com timestamps
    console.log('[WHISPER] Transcrição iniciada');
    await updateJob(videoId, 'TRANSCRIBING');
    await updateVideoStatus(videoId, 'TRANSCRIBING');

    const rawTranscription = await transcribe(audioPath, (progress) => {
      if (progress.type === 'progress') {
        prisma.job.update({
          where: { videoId },
          data: {
            progress: progress.percent,
            currentStep: 'TRANSCRIBING',
            error: null,
          },
        }).catch(() => {}); // Ignore errors in progress updates
      }
    });
    
    const normalized = normalizeTranscription(rawTranscription.segments);

    console.log(`[WHISPER] Transcrição concluída: ${normalized.segments.length} segmentos`);
    for (const warning of normalized.diagnostics.warnings) {
      console.warn(`[WHISPER] ${warning}`);
    }

    if (normalized.diagnostics.suspicious) {
      throw new Error(
        'Transcrição inválida ou vazia. Verifique se o vídeo contém áudio audível e se a API está configurada.'
      );
    }

    await prisma.transcript.create({
      data: {
        videoId,
        fullText: normalized.fullText,
        language: 'pt',
        provider: describeTranscriptionProvider(),
        segments: {
          create: normalized.segments.map((seg) => ({
            segmentIndex: seg.id,
            startTime: seg.start,
            endTime: seg.end,
            text: seg.text,
          })),
        },
      },
    });

    // 4. Análise com IA
    console.log('[AI] Análise iniciada');
    await updateJob(videoId, 'ANALYZING');
    await updateVideoStatus(videoId, 'ANALYZING');

    const analysis = await analyzeWithAi({
      fullText: normalized.fullText,
      segments: normalized.segments,
      videoDuration: video.duration,
      language: 'pt',
    });

    console.log(`[AI] Candidatos encontrados: ${analysis.cuts.length}`);

    // 5. Validação anti-alucinação e ranking global
    await updateJob(videoId, 'GENERATING_CUTS');
    await updateVideoStatus(videoId, 'GENERATING_CUTS');

    const settings = readSettings();
    const report = validateCuts(analysis.cuts, {
      videoDuration: video.duration,
      segments: normalized.segments,
      maxCuts: settings.maxCuts,
      overlapThreshold: settings.overlapThreshold,
      minCutDuration: settings.minCutDuration,
      maxCutDuration: settings.maxCutDuration,
    });

    for (const rejection of report.rejected) {
      console.warn(`[AI] Corte #${rejection.rank} descartado — ${rejection.reason}`);
    }

    console.log(`[AI] Ranking final criado: ${report.cuts.length} cortes`);
    if (report.notice) console.warn(`[AI] ${report.notice}`);

    // Sem chave de transcrição os cortes saem de uma transcrição sintética.
    // Dizer isso é obrigatório: o usuário precisa saber que não são cortes reais.
    const activeProvider = settings.aiProvider;
    const providerConfig = AI_PROVIDERS[activeProvider];
    const hasAiKey = providerConfig.requiresKey 
      ? (await getApiKey(activeProvider as AiProviderId)) !== undefined
      : true; // local e ollama não precisam de chave
    const synthetic =
      describeTranscriptionProvider() === 'mock' || !hasAiKey
        ? 'Nenhuma chave de transcrição/IA configurada: a transcrição é SINTÉTICA e os ' +
          'cortes são blocos por tempo, não conteúdo real identificado. Configure as ' +
          'chaves em Configurações para análise real.'
        : null;

    const notice = [synthetic, report.notice].filter(Boolean).join(' ') || null;

    await prisma.analysisResult.create({
      data: {
        videoId,
        controversies: JSON.stringify(report.cuts.length ? analysis.controversies : []),
        top5: JSON.stringify(report.cuts.slice(0, 5).map((c) => c.rank)),
        requestedCuts: settings.maxCuts,
        generatedCuts: report.cuts.length,
        notice,
        rejected: JSON.stringify(report.rejected),
      },
    });

    if (report.cuts.length > 0) {
      await prisma.cut.createMany({
        data: report.cuts.map((cut) => ({
          videoId,
          rank: cut.rank,
          startTime: cut.startTime,
          endTime: cut.endTime,
          duration: cut.duration,
          theme: cut.theme,
          subject: cut.subject,
          whyViral: cut.whyViral,
          hook: cut.hook,
          strongestMoment: cut.strongestMoment,
          conclusion: cut.conclusion,
          retentionScore: cut.retentionScore,
          commentsScore: cut.commentsScore,
          sharesScore: cut.sharesScore,
          controversyScore: cut.controversyScore,
          curiosityScore: cut.curiosityScore,
          emotionScore: cut.emotionScore,
          replayScore: cut.replayScore,
          viralPotential: cut.viralPotential,
          headline: cut.headline,
          alternativeHeadline: cut.alternativeHeadline,
        })),
      });
    }

    await updateJob(videoId, 'COMPLETED');
    await updateVideoStatus(videoId, 'COMPLETED');
    console.log(`[VIDEO] Processamento concluído: ${videoId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof AiNotConfiguredError) {
      console.error(`[ERROR] ${message}`);
    } else if (error instanceof AiAnalysisError) {
      console.error(`[ERROR] IA: ${message}`);
    } else {
      console.error(`[ERROR] Processamento ${videoId}:`, message);
    }

    await updateJob(videoId, 'FAILED', message);
    await updateVideoStatus(videoId, 'FAILED');
  } finally {
    // Limpa áudio temporário — nunca apaga o vídeo original
    cleanupTempFiles(audioPath);
  }
}

export async function registerVideoRoutes(app: FastifyInstance): Promise<void> {
  /** Upload de vídeo. Retorna imediatamente com o ID do job. */
  app.post('/api/videos', async (request, reply) => {
    let file: Awaited<ReturnType<typeof request.file>>;

    try {
      file = await request.file();
    } catch {
      // Requisição sem multipart (ex.: body vazio) — @fastify/multipart lança.
      return reply.code(400).send({
        error: 'Envie um arquivo de vídeo no campo "file" (multipart/form-data).',
      });
    }

    if (!file) {
      return reply.code(400).send({ error: 'Nenhum arquivo enviado.' });
    }

    if (!isAllowedVideo(file.mimetype, file.filename)) {
      return reply.code(415).send({
        error: `Formato não suportado: ${file.mimetype}. Aceitos: .mp4, .mov, .webm, .mkv`,
      });
    }

    const videoId = uuidv4();
    const safeName = file.filename.replace(/[^\w.\-]+/g, '_');
    const videoPath = path.join(PATHS.uploads, `${videoId}-${safeName}`);

    console.log(`[VIDEO] Upload iniciado: ${file.filename}`);

    const writeStream = (await fs.open(videoPath, 'w')).createWriteStream();
    await new Promise<void>((resolve, reject) => {
      file.file.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      file.file.on('error', reject);
    });

    const { size } = await fs.stat(videoPath);
    console.log(`[VIDEO] Arquivo salvo: ${safeName} (${(size / 1024 / 1024).toFixed(2)} MB)`);

    let technical;
    try {
      technical = await getVideoTechnicalInfo(videoPath);
      console.log(
        `[FFMPEG] Metadados obtidos: ${technical.duration.toFixed(2)}s ${technical.width}x${technical.height} @${technical.fps}fps`
      );
    } catch (error) {
      await fs.rm(videoPath, { force: true });
      const message = error instanceof Error ? error.message : 'Erro ao ler metadados';
      console.error(`[ERROR] ${message}`);
      return reply.code(400).send({ error: `Não foi possível ler o vídeo: ${message}` });
    }

    if (!technical.hasAudio) {
      await fs.rm(videoPath, { force: true });
      return reply.code(400).send({ error: 'O vídeo enviado não possui trilha de áudio.' });
    }

    await prisma.video.create({
      data: {
        id: videoId,
        originalName: file.filename,
        filePath: videoPath,
        mimeType: file.mimetype,
        size,
        duration: technical.duration,
        width: technical.width,
        height: technical.height,
        fps: technical.fps,
        status: 'QUEUED',
      },
    });

    await jobRepository.create({ videoId });

    jobQueue.registerHandler(videoId, processVideoPipeline);
    await jobQueue.enqueue(videoId);

    return reply.code(202).send({ videoId, status: 'QUEUED' });
  });

  /** Status do processamento — usado pelo polling do frontend. */
  app.get<{ Params: { id: string } }>('/api/videos/:id/status', async (request, reply) => {
    const { id } = request.params;

    const video = await prisma.video.findUnique({ where: { id } });
    if (!video) {
      return reply.code(404).send({ error: 'Vídeo não encontrado.' });
    }

    const job = await prisma.job.findUnique({ where: { videoId: id } });
    const status = (job?.status ?? video.status) as VideoJobStatus;
    const step = getStepDefinition(status);

    return reply.send({
      status,
      progress: job?.progress ?? step.progress,
      message: job?.error ?? step.message,
      error: job?.error ?? null,
    });
  });

  /** Resultado final: cortes + ranking + polêmicas + top 5. */
  app.get<{ Params: { id: string } }>('/api/videos/:id/result', async (request, reply) => {
    const { id } = request.params;

    const video = await prisma.video.findUnique({
      where: { id },
      include: {
        cuts: { orderBy: { rank: 'asc' } },
        analysisResult: true,
      },
    });

    if (!video) {
      return reply.code(404).send({ error: 'Vídeo não encontrado.' });
    }

    const analysis = video.analysisResult;

    return reply.send({
      video: {
        id: video.id,
        originalName: video.originalName,
        duration: video.duration,
        width: video.width,
        height: video.height,
        fps: video.fps,
        status: video.status,
        createdAt: video.createdAt,
        streamUrl: `/api/videos/${video.id}/stream`,
      },
      cuts: video.cuts,
      controversies: analysis ? JSON.parse(analysis.controversies) : [],
      top5: analysis ? JSON.parse(analysis.top5) : video.cuts.slice(0, 5).map((c) => c.rank),
      requestedCuts: analysis?.requestedCuts ?? DEFAULT_MAX_CUTS,
      generatedCuts: analysis?.generatedCuts ?? video.cuts.length,
      notice: analysis?.notice ?? null,
      rejected: analysis ? JSON.parse(analysis.rejected) : [],
    });
  });

  /** Transcrição completa com timestamps. */
  app.get<{ Params: { id: string } }>('/api/videos/:id/transcript', async (request, reply) => {
    const { id } = request.params;

    const transcript = await prisma.transcript.findUnique({
      where: { videoId: id },
      include: { segments: { orderBy: { segmentIndex: 'asc' } } },
    });

    if (!transcript) {
      return reply.code(404).send({ error: 'Transcrição não encontrada.' });
    }

    return reply.send({
      id: transcript.id,
      language: transcript.language,
      provider: transcript.provider,
      fullText: transcript.fullText,
      segments: transcript.segments.map((seg) => ({
        id: seg.id,
        start: seg.startTime,
        end: seg.endTime,
        text: seg.text,
      })),
    });
  });

  /** Histórico de vídeos. */
  app.get('/api/videos', async (_request, reply) => {
    const videos = await prisma.video.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { cuts: { orderBy: { rank: 'asc' }, take: 1 } },
    });

    return reply.send({
      videos: videos.map((video) => {
        const topCut = video.cuts[0];
        return {
          id: video.id,
          originalName: video.originalName,
          duration: video.duration,
          width: video.width,
          height: video.height,
          fps: video.fps,
          status: video.status,
          createdAt: video.createdAt,
          cutsCount: undefined,
          topCut: topCut
            ? {
                rank: topCut.rank,
                theme: topCut.theme,
                viralPotential: topCut.viralPotential,
                headline: topCut.headline,
              }
            : null,
        };
      }),
    });
  });

  /** Stream do vídeo original — necessário para o player e para pular trechos. */
  app.get<{ Params: { id: string } }>('/api/videos/:id/stream', async (request, reply) => {
    const { id } = request.params;
    const video = await prisma.video.findUnique({ where: { id } });

    if (!video) {
      return reply.code(404).send({ error: 'Vídeo não encontrado.' });
    }

    try {
      await fs.access(video.filePath);
    } catch {
      return reply.code(404).send({ error: 'Arquivo de vídeo não encontrado no storage.' });
    }

    // @fastify/static resolve sendFile() a partir da raiz registrada.
    // Passamos o caminho relativo (sempre com "/" mesmo no Windows).
    const relativePath = path.relative(PATHS.storage, video.filePath).split(path.sep).join('/');

    // Header manual: garante que o player possa pular para o startTime do corte.
    reply.header('Accept-Ranges', 'bytes');
    return reply.sendFile(relativePath);
  });

  /** Importa arquivo de legenda SRT/VTT para um vídeo existente. */
  app.post<{ Params: { id: string } }>('/api/videos/:id/import-srt', async (request, reply) => {
    const { id } = request.params;

    const video = await prisma.video.findUnique({ where: { id } });
    if (!video) {
      return reply.code(404).send({ error: 'Vídeo não encontrado.' });
    }

    let file: Awaited<ReturnType<typeof request.file>>;
    try {
      file = await request.file();
    } catch {
      return reply.code(400).send({ error: 'Envie um arquivo SRT/VTT no campo "file".' });
    }

    if (!file) {
      return reply.code(400).send({ error: 'Nenhum arquivo enviado.' });
    }

    const allowedExt = ['.srt', '.vtt'];
    const ext = path.extname(file.filename).toLowerCase();
    if (!allowedExt.includes(ext)) {
      return reply.code(415).send({ error: 'Formato não suportado. Use .srt ou .vtt' });
    }

    const content = await file.toBuffer();
    const text = content.toString('utf-8');

    // Parse SRT/VTT simples
    const segments = parseSubtitleFile(text, ext);

    if (segments.length === 0) {
      return reply.code(400).send({ error: 'Nenhum segmento válido encontrado no arquivo.' });
    }

    // Salvar transcrição
    await prisma.transcript.upsert({
      where: { videoId: id },
      create: {
        videoId: id,
        fullText: segments.map((s) => s.text).join(' '),
        language: 'pt',
        provider: 'srt-import',
        segments: {
          create: segments.map((seg, idx) => ({
            segmentIndex: idx,
            startTime: seg.start,
            endTime: seg.end,
            text: seg.text,
          })),
        },
      },
      update: {
        fullText: segments.map((s) => s.text).join(' '),
        language: 'pt',
        provider: 'srt-import',
        segments: {
          deleteMany: {},
          create: segments.map((seg, idx) => ({
            segmentIndex: idx,
            startTime: seg.start,
            endTime: seg.end,
            text: seg.text,
          })),
        },
      },
    });

    // Atualizar status do vídeo para permitir análise
    await prisma.video.update({ where: { id }, data: { status: 'COMPLETED' } });

    return reply.send({ segments: segments.length, message: 'Legendas importadas com sucesso.' });
  });
}

function parseSubtitleFile(content: string, ext: string): Array<{ start: number; end: number; text: string }> {
  const segments: Array<{ start: number; end: number; text: string }> = [];

  if (ext === '.srt') {
    // SRT format: index\nHH:MM:SS,mmm --> HH:MM:SS,mmm\ntext\n\n
    const blocks = content.trim().split(/\n\s*\n/);
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 3) continue;
      const timeLine = lines[1].trim();
      const match = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
      if (!match) continue;
      const start = parseSRTTime(match[1]);
      const end = parseSRTTime(match[2]);
      const text = lines.slice(2).join('\n').trim();
      if (text) segments.push({ start, end, text });
    }
  } else if (ext === '.vtt') {
    // VTT format: WEBVTT\n\nHH:MM:SS.mmm --> HH:MM:SS.mmm\ntext\n\n
    const lines = content.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      const match = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);
      if (match) {
        const start = parseVTTTime(match[1]);
        const end = parseVTTTime(match[2]);
        i++;
        const textLines: string[] = [];
        while (i < lines.length && lines[i].trim() !== '') {
          textLines.push(lines[i].trim());
          i++;
        }
        const text = textLines.join('\n').trim();
        if (text) segments.push({ start, end, text });
      }
      i++;
    }
  }

  return segments;
}

function parseSRTTime(time: string): number {
  const [hms, ms] = time.split(',');
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s + Number(ms) / 1000;
}

function parseVTTTime(time: string): number {
  const [hms, ms] = time.split('.');
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s + Number(ms) / 1000;
}

export { jobQueue, DEFAULT_MAX_CUTS };