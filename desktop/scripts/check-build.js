/**
 * Verifica se o app tem tudo para rodar antes de abrir a janela.
 *
 * Falhar aqui é muito melhor do que abrir uma janela branca: cada item
 * ausente vira um erro concreto, com o comando que resolve.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');

const REQUIRED = [
  {
    label: 'main process compilado',
    path: path.join(ROOT, 'dist', 'main.js'),
    hint: 'cd desktop && npm run build',
  },
  {
    label: 'preload compilado',
    path: path.join(ROOT, 'dist', 'preload.js'),
    hint: 'cd desktop && npm run build',
  },
  {
    label: 'backend compilado',
    path: path.join(REPO, 'backend', 'dist', 'index.js'),
    hint: 'cd backend && npm run build',
  },
  {
    label: 'frontend compilado',
    path: path.join(REPO, 'frontend', 'dist', 'index.html'),
    hint: 'cd frontend && npm run build',
  },
  {
    label: 'FFmpeg embutido',
    path: path.join(ROOT, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
    hint: 'cd desktop && npm run fetch-ffmpeg',
    // O FFmpeg do sistema funciona em dev; só é obrigatório no empacotado.
    required: !process.env.VIRAL_CUT_SKIP_FFMPEG_CHECK,
  },
];

const missing = REQUIRED.filter((item) => !fs.existsSync(item.path));

if (missing.length === 0) {
  process.stdout.write('[check-build] tudo pronto.\n');
  process.exit(0);
}

process.stderr.write('\n[check-build] Faltam arquivos para rodar o app:\n\n');
for (const item of missing) {
  process.stderr.write(`  ✗ ${item.label}\n`);
  process.stderr.write(`    → ${item.hint}\n`);
}
process.stderr.write('\n');

process.exit(1);