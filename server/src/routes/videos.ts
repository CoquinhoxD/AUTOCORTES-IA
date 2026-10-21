import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import multipart from '@fastify/multipart';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';

// Importação dos serviços construídos anteriormente
import { FfmpegService } from '../services/ffmpeg.service';
import { TranscriptionService } from '../services/transcription.service';

// Inicialização dos serviços locais do escopo das rotas
const ffmpegService = new FfmpegService();
const transcriptionService = new TranscriptionService();

// Definição dos Estados do Job (Conforme Item 12 do Prompt original)
type JobStatus = 
  | 'QUEUED' 
  | 'UPLOADING' 
  | 'PROCESSING_VIDEO' 
  | 'EXTRACTING_AUDIO' 
  | 'TRANSCRIBING' 
  | 'ANALYZING' 
  | 'GENERATING_CUTS' 
  | 'COMPLETED' 
  | 'FAILED';

interface JobData {
  id: string;
  videoId: string;
  status: JobStatus;
  progress: number;
  currentStep: string;
  error?: string;
}

// Banco de dados em memória temporário para a Fase 1 (Preparado para BullMQ + Redis / Prisma)
export const jobsQueueStore = new Map<string, JobData>();
export const videosStore = new Map<string, any>();

// Configurações de diretórios locais de armazenamento
const STORAGE_DIR = path.join(__dirname, '../../../storage');
const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');
const AUDIO_DIR = path.join(STORAGE_DIR, 'audio');

// Garante a existência da árvore de diretórios na inicialização
[UPLOADS_DIR, AUDIO_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/**
 * Função de Processamento em Segundo Plano (Assíncrona com setImmediate)
 * Não segura a requisição HTTP e atualiza o estado em tempo real.
 */
function processVideoInBackground(jobId: string, videoId: string, tempFilePath: string, originalName: string, mimeType: string) {
  setImmediate(async () => {
    const job = jobsQueueStore.get(jobId);
    if (!job) return;

    try {
      // 1. Processamento e extração de Metadados
      job.status = 'PROCESSING_VIDEO';
      job.progress = 20;
      job.currentStep = 'Analisando dimensões e metadados com FFprobe...';
      jobsQueueStore.set(jobId, { ...job });

      const metadata = await ffmpegService.getVideoMetadata(tempFilePath);
      
      // Atualiza o registro estruturado do vídeo no Mock DB
      const videoRecord = {
        id: videoId,
        originalName,
        filePath: tempFilePath,
        mimeType,
        size: fs.statSync(tempFilePath).size,
        ...metadata,
        status: 'PROCESSING'
      };
      videosStore.set(videoId, videoRecord);

      // 2. Extração de Áudio
      job.status = 'EXTRACTING_AUDIO';
      job.progress = 45;
      job.currentStep = 'Extraindo faixa de áudio em formato mono 16kHz...';
      jobsQueueStore.set(jobId, { ...job });

      const audioPath = await ffmpegService.extractAudio(tempFilePath, AUDIO_DIR);

      // 3. Transcrição com Whisper
      job.status = 'TRANSCRIBING';
      job.progress = 70;
      job.currentStep = 'Enviando áudio extraído para transcrição via Whisper API...';
      jobsQueueStore.set(jobId, { ...job });

      const transcriptionResult = await transcriptionService.transcribe(audioPath);

      // 4. Análise de IA e Geração dos 20 Cortes (Pulado temporariamente conforme sua instrução atual)
      job.status = 'ANALYZING';
      job.progress = 90;
      job.currentStep = 'Gerando inteligência de retenção e ranking global dos cortes...';
      jobsQueueStore.set(jobId, { ...job });

      // TODO: Integrar com AiAnalysisService nas próximas sprints

      // Finalização com sucesso
      job.status = 'COMPLETED';
      job.progress = 100;
      job.currentStep = 'Processamento concluído! Pronto para validação no player.';
      jobsQueueStore.set(jobId, { ...job });
      
      videoRecord.status = 'COMPLETED';
      videosStore.set(videoId, videoRecord);

    } catch (error: any) {
      console.error(`[Job Error - ${jobId}]:`, error);
      job.status = 'FAILED';
      job.progress = 100;
      job.currentStep = 'Erro fatal durante o processamento do pipeline.';
      job.error = error.message || 'Erro interno desconhecido.';
      jobsQueueStore.set(jobId, { ...job });
      
      const videoRecord = videosStore.get(videoId);
      if (videoRecord) {
        videoRecord.status = 'FAILED';
        videosStore.set(videoId, videoRecord);
      }
    }
  });
}

/**
 * Módulo de Rotas Fastify para Vídeos
 */
export async function videoRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  
  // Limite configurável de tamanho lido dinamicamente do seu .env (Item 10)
  const maxVideoSizeMb = parseInt(process.env.MAX_VIDEO_SIZE_MB || '500', 10);
  
  // Registra o plugin oficial de multipart com suporte a streams
  await fastify.register(multipart, {
    limits: {
      fileSize: maxVideoSizeMb * 1024 * 1024 // Conversão direta para bytes
    }
  });

  /**
   * POST /api/videos
   * Recebe o arquivo em modo Stream, salva no disco e delega para a fila.
   */
  fastify.post('/videos', async (request, reply) => {
    const data = await request.file();
    
    if (!data) {
      return reply.status(400).send({ error: 'Nenhum arquivo de vídeo enviado.' });
    }

    const videoId = uuidv4();
    const jobId = uuidv4();
    const fileExtension = path.extname(data.filename);
    const targetFileName = `${videoId}${fileExtension}`;
    const destinationPath = path.join(UPLOADS_DIR, targetFileName);

    // Inicializa o Job no Store em memória como UPLOADING
    const newJob: JobData = {
      id: jobId,
      videoId,
      status: 'UPLOADING',
      progress: 5,
      currentStep: 'Gravando fluxo binário do vídeo diretamente em disco (Streaming)...'
    };
    jobsQueueStore.set(jobId, newJob);

    try {
      // Executa o pipeline de stream para evitar estouro de memória RAM
      await pipeline(data.file, fs.createWriteStream(destinationPath));

      // Atualiza o estado para a entrada oficial na Fila
      newJob.status = 'QUEUED';
      newJob.progress = 10;
      newJob.currentStep = 'Vídeo salvo com sucesso. Entrando na fila de processamento assíncrono.';
      jobsQueueStore.set(jobId, newJob);

      // Dispara o loop assíncrono fora do ciclo de vida da requisição HTTP (Item 11)
      processVideoInBackground(jobId, videoId, destinationPath, data.filename, data.mimetype);

      // Retorna imediatamente o ID do Job para o Frontend monitorar (Polling)
      return reply.status(202).send({
        videoId,
        jobId,
        status: 'queued'
      });

    } catch (err: any) {
      newJob.status = 'FAILED';
      newJob.currentStep = 'Falha crítica durante o upload de arquivo via stream.';
      newJob.error = err.message;
      jobsQueueStore.set(jobId, newJob);
      
      return reply.status(500).send({ error: 'Falha ao processar o upload do vídeo.' });
    }
  });

  /**
   * GET /api/videos/:id/status
   * Endpoint de verificação de progresso consumido pelo hook react (Item 14)
   */
  fastify.get('/videos/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    const job = jobsQueueStore.get(id);
    
    if (!job) {
      return reply.status(404).send({ error: 'Job de processamento não encontrado.' });
    }

    return {
      status: job.status,
      progress: job.progress,
      message: job.currentStep,
      ...(job.error && { error: job.error })
    };
  });
}
