import Fastify from 'fastify';
import dotenv from 'dotenv';
import { videoRoutes } from './routes/videos';

// Carrega as variáveis de ambiente do .env corporativo
dotenv.config();

const fastify = Fastify({
  logger: true
});

// Registro das rotas modulares com o prefixo global da API
fastify.register(videoRoutes, { prefix: '/api' });

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3333', 10);
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Servidor VIRAL CUT AI rodando em http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
