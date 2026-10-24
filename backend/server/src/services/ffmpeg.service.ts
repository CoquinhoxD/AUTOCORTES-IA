import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ProbeResult, VideoTechnicalInfo } from '../types/ffmpeg.js';

const execAsync = promisify(execCallback);

/**
 * Resolve o caminho dos binários do FFmpeg.
 *
 * No app desktop o FFmpeg vem embutido em `resources/bin` — o Electron
 * injeta esse caminho em VIRAL_CUT_BIN_DIR. Em desenvolvimento cai no
 * PATH do sistema, para não duplicar 80MB no repositório.
 */
function resolveBinDir(): string | null {
  const configured = process.env.VIRAL_CUT_BIN_DIR?.trim();
  if (!configured) return null;

  const candidates = process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'];

  for (const name of candidates) {
    const full = path.join(configured, name);
    if (fs.existsSync(full)) return configured;
  }
  return null;
}

/** Caminho absoluto quando embutido, senão o nome (resolvido pelo PATH). */
export function binPath(name: 'ffmpeg' | 'ffprobe'): string {
  const dir = resolveBinDir();
  return dir ? path.join(dir, process.platform === 'win32' ? `${name}.exe` : name) : name;
}

const FFMPEG = () => binPath('ffmpeg');
const FFPROBE = () => binPath('ffprobe');

/**
 * Verifica se FFmpeg e FFprobe estão disponíveis.
 * Erro não é escondido — a aplicação não sobe sem isso.
 */
export async function checkFFmpeg(): Promise<void> {
  const bundled = resolveBinDir();
  const source = bundled ? `embutido (${bundled})` : 'PATH do sistema';

  try {
    await execAsync(`"${FFMPEG()}" -version`);
    await execAsync(`"${FFPROBE()}" -version`);
    console.log(`[FFMPEG] FFmpeg e FFprobe encontrados — origem: ${source}`);
  } catch {
    console.error('[FFMPEG] FFmpeg ou FFprobe NÃO encontrado');
    throw new Error(
      bundled
        ? `FFmpeg embutido ausente em ${bundled}. Reinstale o aplicativo.`
        : 'FFmpeg ou ffprobe não encontrado. Instale o FFmpeg e adicione ao PATH. ' +
          'Download: https://ffmpeg.org/download.html'
    );
  }
}

/** Executa o binário informado e rejeita se retornar código diferente de zero. */
function runBinary(bin: string, args: string[], label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => (stdout += chunk));
    proc.stderr.on('data', (chunk) => (stderr += chunk));

    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new Error(
            `${label} não encontrado. Reinstale o aplicativo ou instale o FFmpeg no PATH.`
          )
        );
        return;
      }
      reject(err);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${label} falhou (código ${code}): ${stderr.trim().slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/** Metadados técnicos via ffprobe. */
export async function ffprobe(filePath: string): Promise<ProbeResult> {
  const stdout = await runBinary(
    FFPROBE(),
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    'ffprobe'
  );

  try {
    return JSON.parse(stdout) as ProbeResult;
  } catch {
    throw new Error('ffprobe retornou JSON inválido');
  }
}

/** Converte a string de frame rate do ffprobe ("30000/1001") em número. Sem eval(). */
export function parseFrameRate(rate?: string): number {
  if (!rate || typeof rate !== 'string') return 0;
  const [numerator, denominator] = rate.split('/').map(Number);
  if (!numerator || !denominator) return 0;
  return Number((numerator / denominator).toFixed(3));
}

/** Extrai informações técnicas consolidadas do vídeo. */
export async function getVideoTechnicalInfo(filePath: string): Promise<VideoTechnicalInfo> {
  const probe = await ffprobe(filePath);
  const videoStream = probe.streams?.find((s) => s.codec_type === 'video');
  const audioStream = probe.streams?.find((s) => s.codec_type === 'audio');

  return {
    duration: probe.format?.duration ? Number(probe.format.duration) : 0,
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    fps: parseFrameRate(videoStream?.avg_frame_rate || videoStream?.r_frame_rate),
    hasAudio: Boolean(audioStream),
    hasVideo: Boolean(videoStream),
    videoCodec: videoStream?.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
    sizeBytes: probe.format?.size ? Number(probe.format.size) : 0,
  };
}

/**
 * Extrai áudio para Whisper: MP3 mono 16 kHz.
 * Usa streams (nunca carrega o vídeo inteiro na memória).
 */
export async function ffmpegExtractAudio(videoPath: string, audioPath: string): Promise<void> {
  await runBinary(
    FFMPEG(),
    [
      '-i', videoPath,
      '-vn',                 // descarta vídeo
      '-acodec', 'libmp3lame',
      '-b:a', '32k',         // mantém o arquivo pequeno para envio à API
      '-ar', '16000',        // 16 kHz exigido pelo Whisper
      '-ac', '1',            // mono
      '-y',                  // sobrescreve
      audioPath,
    ],
    'ffmpeg (extração de áudio)'
  );

  console.log('[FFMPEG] Áudio extraído com sucesso');
}

/**
 * Recorte de vídeo por tempo — preparado para as fases futuras (corte automático).
 * Ainda não é exposto na API da Fase 1.
 */
export async function ffmpegCutClip(
  inputPath: string,
  outputPath: string,
  startTime: number,
  endTime: number,
  options: { reencode?: boolean } = {}
): Promise<void> {
  if (endTime <= startTime) {
    throw new Error('endTime deve ser maior que startTime');
  }
  if (startTime < 0) {
    throw new Error('startTime não pode ser negativo');
  }

  const duration = (endTime - startTime).toFixed(3);

  // reencode=false faz stream copy (rápido, mas corta na keyframe mais próxima)
  const args = options.reencode
    ? ['-i', inputPath, '-ss', String(startTime), '-t', duration,
       '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
       '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', outputPath]
    : ['-ss', String(startTime), '-i', inputPath, '-t', duration,
       '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-y', outputPath];

  await runBinary(FFMPEG(), args, 'ffmpeg (corte de vídeo)');
  console.log(`[FFMPEG] Corte gerado: ${outputPath} (${startTime}s → ${endTime}s)`);
}

/**
 * Converte vídeo horizontal para vertical 9:16.
 * Usa crop centralizado com fundo desfocado (modo "blur") ou crop de rosto (face tracking).
 */
export async function ffmpegVerticalCrop(
  inputPath: string,
  outputPath: string,
  options: { mode?: 'center' | 'blur' | 'face'; width?: number; height?: number } = {}
): Promise<void> {
  const { mode = 'blur', width = 1080, height = 1920 } = options;

  let filterComplex: string;

  if (mode === 'blur') {
    // Fundo desfocado + vídeo original centralizado (pillarbox)
    filterComplex = `
      [0:v]split=2[original][blur];
      [blur]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=20[bg];
      [original]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg];
      [bg][fg]overlay=(W-w)/2:(H-h)/2
    `.replace(/\s+/g, ' ').trim();
  } else if (mode === 'center') {
    // Crop central simples
    filterComplex = `crop=ih*9/16:ih:(ow-iw)/2:0,scale=${width}:${height}`;
  } else {
    // Face tracking - usa detecção de rosto (requer modelo DNN, fallback para center)
    filterComplex = `crop=ih*9/16:ih:(ow-iw)/2:0,scale=${width}:${height}`;
  }

  await runBinary(
    FFMPEG(),
    [
      '-i', inputPath,
      '-vf', filterComplex,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', '-y', outputPath,
    ],
    'ffmpeg (crop vertical 9:16)'
  );
  console.log(`[FFMPEG] Crop vertical 9:16 gerado: ${outputPath} (mode: ${mode})`);
}

/**
 * Gera arquivo SRT a partir dos segmentos de transcrição.
 * Filtra apenas segmentos dentro do intervalo [startTime, endTime].
 */
export async function ffmpegGenerateSRT(
  segments: Array<{ segmentIndex: number; startTime: number; endTime: number; text: string }>,
  outputPath: string,
  startTime: number,
  endTime: number
): Promise<void> {
  const fs = await import('fs');

  let srtContent = '';
  let index = 1;

  for (const seg of segments) {
    // Só inclui segmentos que intersectam com o intervalo do corte
    if (seg.endTime <= startTime || seg.startTime >= endTime) continue;

    // Ajustar timestamps relativos ao início do corte
    const relStart = Math.max(0, seg.startTime - startTime);
    const relEnd = Math.min(endTime - startTime, seg.endTime - startTime);

    if (relEnd <= relStart) continue;

    srtContent += `${index}\n`;
    srtContent += `${formatSRTTime(relStart)} --> ${formatSRTTime(relEnd)}\n`;
    srtContent += `${seg.text.trim()}\n\n`;
    index++;
  }

  fs.writeFileSync(outputPath, srtContent.trim() + '\n', 'utf-8');
  console.log(`[FFMPEG] SRT gerado: ${outputPath} (${index - 1} legendas)`);
}

/**
 * Queima legendas SRT no vídeo.
 * Estilos: viral (clássico TikTok), word (palavra por palavra), minimal, gamer, podcast, custom.
 */
export async function ffmpegBurnSubtitles(
  inputPath: string,
  srtPath: string,
  outputPath: string,
  style: 'viral' | 'word' | 'minimal' | 'gamer' | 'podcast' | 'custom' = 'viral'
): Promise<void> {
  // Estilos baseados em força relativa, posição segura para TikTok/Shorts/Reels
  const styles: Record<string, string> = {
    viral: `
      FontName=Arial,
      FontSize=28,
      Bold=1,
      PrimaryColour=&HFFFFFF,
      OutlineColour=&H000000,
      Outline=3,
      Shadow=1,
      Alignment=2,
      MarginV=80,
      MarginL=40,
      MarginR=40,
      WrapStyle=2
    `.replace(/\s+/g, ' ').trim(),

    word: `
      FontName=Arial,
      FontSize=32,
      Bold=1,
      PrimaryColour=&HFFFFFF,
      OutlineColour=&H000000,
      Outline=3,
      Shadow=1,
      Alignment=2,
      MarginV=80,
      MarginL=40,
      MarginR=40,
      WrapStyle=2
    `.replace(/\s+/g, ' ').trim(),

    minimal: `
      FontName=Arial,
      FontSize=24,
      Bold=0,
      PrimaryColour=&HFFFFFF,
      OutlineColour=&H000000,
      Outline=2,
      Shadow=0,
      Alignment=2,
      MarginV=100,
      MarginL=20,
      MarginR=20,
      WrapStyle=2
    `.replace(/\s+/g, ' ').trim(),

    gamer: `
      FontName=Impact,
      FontSize=30,
      Bold=1,
      PrimaryColour=&HFFFF00,
      OutlineColour=&H000000,
      Outline=4,
      Shadow=2,
      Alignment=2,
      MarginV=80,
      MarginL=40,
      MarginR=40,
      WrapStyle=2
    `.replace(/\s+/g, ' ').trim(),

    podcast: `
      FontName=Georgia,
      FontSize=26,
      Bold=0,
      PrimaryColour=&HFFFFFF,
      OutlineColour=&H000000,
      Outline=2,
      Shadow=1,
      Alignment=2,
      MarginV=100,
      MarginL=60,
      MarginR=60,
      WrapStyle=2
    `.replace(/\s+/g, ' ').trim(),

    custom: `
      FontName=Arial,
      FontSize=28,
      Bold=1,
      PrimaryColour=&HFFFFFF,
      OutlineColour=&H000000,
      Outline=3,
      Shadow=1,
      Alignment=2,
      MarginV=80,
      MarginL=40,
      MarginR=40,
      WrapStyle=2
    `.replace(/\s+/g, ' ').trim(),
  };

  const styleStr = styles[style] || styles.viral;

  // Escape do caminho SRT para Windows (dois pontos e barras)
  const escapedSrtPath = srtPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:');

  await runBinary(
    FFMPEG(),
    [
      '-i', inputPath,
      '-vf', `subtitles='${escapedSrtPath}':force_style='${styleStr}'`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', '-y', outputPath,
    ],
    'ffmpeg (queimar legendas)'
  );
  console.log(`[FFMPEG] Legendas queimadas: ${outputPath} (style: ${style})`);
}

function formatSRTTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}
