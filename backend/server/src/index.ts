import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { checkFFmpeg } from './services/ffmpeg.service.js';
import { PATHS, ensureStorageDirs } from './config/paths.js';
import { applySettingsToEnv } from './config/settings.js';
import { registerVideoRoutes } from './routes/videos.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerExportRoutes } from './routes/export.js';
import { prisma } from './lib/prisma.js';

dotenv.config();

ensureStorageDirs();

// Inicialização assíncrona para carregar segredos criptografados
async function initialize(): Promise<void> {
  // Chaves salvas pela tela de configurações entram no env antes de qualquer
  // serviço ler process.env — o .env local continua prevalecendo em dev.
  await applySettingsToEnv();

  const maxVideoSizeMb = parseInt(process.env.MAX_VIDEO_SIZE_MB || '2048', 10);
  // Porta 0 = o sistema escolhe uma livre; o Electron lê a porta real abaixo.
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      ...(process.env.NODE_ENV !== 'production' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    bodyLimit: maxVideoSizeMb * 1024 * 1024,
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, '[ERROR]');

    // Limite de tamanho do upload — mensagem explícita para o usuário.
    if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({
        error: `Arquivo excede o limite de ${maxVideoSizeMb} MB. Aumente MAX_VIDEO_SIZE_MB no backend/.env.`,
      });
    }

    reply.code(error.statusCode ?? 500).send({
      error: error.message || 'Erro interno do servidor',
    });
  });

  app.register(multipart, {
    limits: {
      fileSize: maxVideoSizeMb * 1024 * 1024,
      files: 1,
      fields: 10,
    },
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: `Rota não encontrada: ${request.method} ${request.url}` });
  });

  // Necessário para reply.sendFile() — serve com suporte a Range requests,
  // permitindo ao player pular diretamente para o startTime de cada corte.
  app.register(fastifyStatic, {
    root: PATHS.storage,
    prefix: '/static/',
    decorateReply: true,
    index: false,
  });

  await registerVideoRoutes(app);
  await registerSettingsRoutes(app);
  await registerExportRoutes(app);

  /**
   * No app desktop o mesmo processo serve a API e o build do Vite, para que o
   * BrowserWindow abra em http://localhost:<porta> sem proxy. Em desenvolvimento
   * quem serve o front é o Vite, então este bloco é ignorado.
   */
  const frontendDist = process.env.VIRAL_CUT_WEB_DIR?.trim();
  if (frontendDist && fs.existsSync(frontendDist)) {
    const indexHtml = path.join(frontendDist, 'index.html');

    /**
     * SPA fallback. Precisa rodar em `onRequest` — o `setNotFoundHandler` só é
     * chamado depois que nenhuma rota casou, e o `fastifyStatic` com prefixo '/'
     * responde 404 para /settings e /history antes disso.
     */
    app.addHook('onRequest', async (request, reply) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return;
      if (request.url.startsWith('/api/') || request.url.startsWith('/static/')) return;

      // Só redireciona se não houver arquivo real com esse nome (assets).
      const relative = request.url.split('?')[0].replace(/^\/+/, '');
      if (relative && fs.existsSync(path.join(frontendDist, relative))) return;

      return reply.type('text/html').send(fs.readFileSync(indexHtml));
    });

    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      decorateReply: false,
      index: ['index.html'],
    });
  }

  // FFmpeg é obrigatório — o erro não é escondido e o servidor não sobe sem ele.
  try {
    await checkFFmpeg();
  } catch (error) {
    app.log.error(`[FFMPEG] ${(error as Error).message}`);
    app.log.error('[FFMPEG] Instale o FFmpeg: https://ffmpeg.org/download.html');
    process.exit(1);
  }

  try {
    await prisma.$connect();
  } catch (error) {
    app.log.error(`[DATABASE] Falha ao conectar: ${(error as Error).message}`);
    app.log.error('[DATABASE] Execute: npm run prisma:setup');
    process.exit(1);
  }

  app.get('/api/health', async () => ({
    status: 'ok',
    storage: PATHS.storage,
    maxVideoSizeMb,
  }));

  const shutdown = async (signal: string) => {
    app.log.info(`[SERVER] Recebido ${signal}, encerrando...`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  app.listen({ port, host }, (error, address) => {
    if (error) throw error;
    app.log.info(`🚀 VIRAL CUT AI API em ${address}`);
    app.log.info(`📁 Storage: ${PATHS.storage}`);
    app.log.info(`📦 Limite de upload: ${maxVideoSizeMb} MB`);

    // Contrato com o processo main do Electron: imprime a porta efetiva em
    // stdout, que o main lê antes de criar a janela.
    const boundPort = address?.endsWith(`:${port}`)
      ? port
      : Number(new URL(address ?? '').port || port);

    if (process.env.VIRAL_CUT_DESKTOP === '1') {
      process.stdout.write(`SERVER_READY ${boundPort}\n`);
    }
  });
}

initialize().catch((error) => {
  console.error('[FATAL] Falha na inicialização:', error);
  process.exit(1);
});
