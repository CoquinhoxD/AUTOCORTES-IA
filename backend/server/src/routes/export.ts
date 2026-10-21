import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { PATHS } from '../config/paths.js';
import { ffmpegCutClip, ffmpegVerticalCrop } from '../services/ffmpeg.service.js';
import path from 'node:path';

const CutClipSchema = z.object({
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  reencode: z.boolean().default(false),
  vertical: z.boolean().default(false),
});

export async function registerExportRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Exporta um único corte do vídeo original.
   * Body: { startTime, endTime, reencode?, vertical? }
   * Retorna: { outputPath, duration, size }
   */
  app.post<{ Params: { id: string }; Body: z.infer<typeof CutClipSchema> }>(
    '/api/videos/:id/export-cut',
    async (request, reply) => {
      const { id } = request.params;
      const body = CutClipSchema.parse(request.body);

      const video = await prisma.video.findUnique({ where: { id } });
      if (!video) {
        return reply.code(404).send({ error: 'Vídeo não encontrado.' });
      }

      if (body.endTime <= body.startTime) {
        return reply.code(400).send({ error: 'endTime deve ser maior que startTime.' });
      }
      if (body.endTime > video.duration) {
        return reply.code(400).send({ error: `endTime (${body.endTime}s) excede duração do vídeo (${video.duration}s).` });
      }

      const outputFilename = `${id}_cut_${body.startTime.toFixed(1)}_${body.endTime.toFixed(1)}.mp4`;
      const outputPath = path.join(PATHS.results, outputFilename);

      try {
        let inputPath = video.filePath;
        let currentPath = inputPath;

        // 1. Cortar o trecho
        await ffmpegCutClip(inputPath, outputPath, body.startTime, body.endTime, { reencode: body.reencode });
        currentPath = outputPath;

        // 2. Se vertical, fazer crop 9:16
        if (body.vertical) {
          const verticalPath = path.join(PATHS.results, `vertical_${outputFilename}`);
          await ffmpegVerticalCrop(currentPath, verticalPath);
          currentPath = verticalPath;
        }

        // Transcrição é utilizada somente para análise, nunca na exportação.

        // Mover resultado final se passou por múltiplos passos
        if (currentPath !== outputPath) {
          const fs = await import('fs');
          fs.renameSync(currentPath, outputPath);
        }

        const fs = await import('fs');
        const stats = fs.statSync(outputPath);

        return reply.send({
          outputPath,
          filename: outputFilename,
          duration: body.endTime - body.startTime,
          size: stats.size,
          downloadUrl: `/api/videos/${id}/download/${encodeURIComponent(outputFilename)}`,
        });
      } catch (error) {
        console.error('[EXPORT] Erro ao exportar corte:', error);
        return reply.code(500).send({ error: `Falha ao exportar corte: ${(error as Error).message}` });
      }
    }
  );

  /**
   * Exporta múltiplos cortes em lote.
   * Body: { cuts: Array<{ rank, startTime, endTime, ...options }> }
   */
  app.post<{ Params: { id: string }; Body: { cuts: Array<z.infer<typeof CutClipSchema> & { rank: number }> } }>(
    '/api/videos/:id/export-batch',
    async (request, reply) => {
      const { id } = request.params;
      const { cuts } = request.body;

      const video = await prisma.video.findUnique({ where: { id } });
      if (!video) {
        return reply.code(404).send({ error: 'Vídeo não encontrado.' });
      }

      if (!Array.isArray(cuts) || cuts.length === 0) {
        return reply.code(400).send({ error: 'Nenhum corte informado.' });
      }

      const results = [];
      const errors = [];

      for (const rawCut of cuts) {
        const rank = rawCut?.rank;
        try {
          const cut = CutClipSchema.parse(rawCut);
          if (cut.endTime <= cut.startTime || cut.endTime > video.duration) {
            throw new Error('Intervalo do corte inválido ou fora da duração do vídeo.');
          }
          if (!Number.isInteger(rank) || rank < 1) {
            throw new Error('Rank do corte inválido.');
          }
          const outputFilename = `${id}_cut_${rank}_${cut.startTime.toFixed(1)}_${cut.endTime.toFixed(1)}.mp4`;
          const outputPath = path.join(PATHS.results, outputFilename);

          let currentPath = video.filePath;

          // Cortar
          await ffmpegCutClip(currentPath, outputPath, cut.startTime, cut.endTime, { reencode: cut.reencode });
          currentPath = outputPath;

          // Vertical
          if (cut.vertical) {
            const verticalPath = path.join(PATHS.results, `vertical_${outputFilename}`);
            await ffmpegVerticalCrop(currentPath, verticalPath);
            currentPath = verticalPath;
          }

          if (currentPath !== outputPath) {
            const fs = await import('fs');
            fs.renameSync(currentPath, outputPath);
          }

          const fs = await import('fs');
          const stats = fs.statSync(outputPath);

          results.push({
            rank: rank,
            outputPath,
            filename: outputFilename,
            duration: cut.endTime - cut.startTime,
            size: stats.size,
            downloadUrl: `/api/videos/${id}/download/${encodeURIComponent(outputFilename)}`,
          });
        } catch (error) {
          errors.push({ rank: rank, error: (error as Error).message });
        }
      }

      return reply.send({ results, errors, total: results.length, failed: errors.length });
    }
  );

  /**
   * Download de um arquivo exportado.
   */
  app.get<{ Params: { id: string; filename: string } }>(
    '/api/videos/:id/download/:filename',
    async (request, reply) => {
      const { filename } = request.params;
      if (path.basename(filename) !== filename || !filename.startsWith(`${request.params.id}_cut_`) || !filename.endsWith('.mp4')) {
        return reply.code(400).send({ error: 'Nome de arquivo inválido.' });
      }
      const filePath = path.join(PATHS.results, filename);

      const fs = await import('fs');
      try {
        await fs.promises.access(filePath);
      } catch {
        return reply.code(404).send({ error: 'Arquivo não encontrado.' });
      }

      return reply.sendFile(path.relative(PATHS.storage, filePath).split(path.sep).join('/'));
    }
  );

}