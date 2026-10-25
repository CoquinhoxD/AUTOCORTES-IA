/**
 * Executado no runner Windows depois do electron-builder.
 * Verifica o pacote descompactado, não as dependências do workspace.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const backend = path.resolve(__dirname, '..', 'release', 'win-unpacked', 'resources', 'backend');
const generated = path.join(backend, 'node_modules', '.prisma', 'client');
for (const name of ['index.js', 'default.js', 'schema.prisma']) {
  const file = path.join(generated, name);
  if (!fs.existsSync(file)) throw new Error(`Prisma gerado ausente no instalador: ${file}`);
}

const requireFromBackend = createRequire(path.join(backend, 'package.json'));
const { PrismaClient } = requireFromBackend('@prisma/client');
const client = new PrismaClient();
if (typeof client.$connect !== 'function') throw new Error('PrismaClient inválido no pacote');
void client.$disconnect();
process.stdout.write('[desktop] PrismaClient empacotado e inicializado com sucesso.\n');
