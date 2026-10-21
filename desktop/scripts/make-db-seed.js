/**
 * Gera o banco SQLite inicial que vai embutido no instalador.
 *
 * O app instalado não roda `prisma db push` (o CLI é devDependency e não é
 * empacotado), então o primeiro boot precisa encontrar um arquivo .db que já
 * tenha o schema — só que vazio. Reaproveitar o `dev.db` resolveria a tabela,
 * mas entregaria ao usuário final os vídeos de teste de quem empacotou.
 *
 * A saída é `backend/prisma/seed.db`: tabelas do schema.prisma, zero linhas.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BACKEND = path.join(__dirname, '..', '..', 'backend');
const SCHEMA = path.join(BACKEND, 'prisma', 'schema.prisma');
const SEED = path.join(BACKEND, 'prisma', 'seed.db');

if (!fs.existsSync(SCHEMA)) {
  process.stderr.write(`[db-seed] schema não encontrado em ${SCHEMA}\n`);
  process.exit(1);
}

fs.rmSync(SEED, { force: true });

// `db push` cria o arquivo a partir do schema. --skip-generate evita
// recompilar o client (o engine precisa ser o do Node de produção, não o de dev).
execFileSync(
  process.execPath,
  [
    path.join(BACKEND, 'node_modules', 'prisma', 'build', 'index.js'),
    'db',
    'push',
    '--skip-generate',
    '--accept-data-loss',
    `--schema=${SCHEMA}`,
  ],
  {
    cwd: BACKEND,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: `file:${SEED.replace(/\\/g, '/')}`,
    },
  }
);

if (!fs.existsSync(SEED)) {
  process.stderr.write('[db-seed] seed.db não foi criado\n');
  process.exit(1);
}

process.stdout.write(`[db-seed] ${SEED} (${(fs.statSync(SEED).size / 1024).toFixed(0)} KB)\n`);