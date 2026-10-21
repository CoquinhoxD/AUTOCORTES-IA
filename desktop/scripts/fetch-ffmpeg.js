/**
 * Baixa o FFmpeg para desktop/bin, de onde o electron-builder copia para
 * resources/bin. Sem isso o app empacotado não encontraria o executável.
 *
 * Uso: npm run fetch-ffmpeg
 *
 * Se o FFmpeg já estiver instalado no sistema, os binários são copiados
 * dali em vez de baixados (~435MB em vez de ~90MB de download).
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const FFMPEG = path.join(BIN_DIR, 'ffmpeg.exe');
const FFPROBE = path.join(BIN_DIR, 'ffprobe.exe');

// Build "essentials" do gyan.dev — bem menor que o "full" e suficiente
// para extrair áudio e cortar vídeo.
const ASSET_URL =
  'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip';
const ZIP_PATH = path.join(BIN_DIR, 'ffmpeg.zip');

const TARGETS = [
  { name: 'ffmpeg.exe', path: FFMPEG },
  { name: 'ffprobe.exe', path: FFPROBE },
];

function log(message) {
  process.stdout.write(`[fetch-ffmpeg] ${message}\n`);
}

function alreadyPresent() {
  return TARGETS.every((t) => fs.existsSync(t.path));
}

/** Copia de uma instalação local, se existir. */
function copyFromSystem() {
  for (const target of TARGETS) {
    try {
      const resolved = execFileSync('where', [target.name], { encoding: 'utf-8' })
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);

      if (!resolved) continue;

      // where pode devolver um atalho do WinGet; resolve o alvo real.
      let source = resolved;
      if (fs.lstatSync(source).isSymbolicLink()) {
        source = fs.realpathSync(source);
      }

      fs.copyFileSync(source, target.path);
      log(`copiado de ${source}`);
    } catch {
      // Executável não encontrado no PATH — tenta o próximo.
    }
  }

  return alreadyPresent();
}

function download(url, destination, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          if (redirectsLeft === 0) {
            reject(new Error('muitos redirecionamentos'));
            return;
          }
          resolve(download(response.headers.location, destination, redirectsLeft - 1));
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode} em ${url}`));
          return;
        }

        const total = Number(response.headers['content-length'] ?? 0);
        let received = 0;
        let lastReport = 0;

        const file = fs.createWriteStream(destination);
        response.pipe(file);

        response.on('data', (chunk) => {
          received += chunk.length;
          // Reporta a cada 10% para não poluir o terminal.
          const percent = total ? Math.floor((received / total) * 100) : 0;
          if (percent >= lastReport + 10) {
            lastReport = percent;
            log(`download ${percent}%`);
          }
        });

        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

/** Extrai os .exe do zip usando o tar do Windows (11+) ou o PowerShell. */
function extractExecutables() {
  const tar = tryTar();
  if (tar) {
    execFileSync(tar, ['-xf', ZIP_PATH, '-C', BIN_DIR], { stdio: 'ignore' });
  } else {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${ZIP_PATH}' -DestinationPath '${BIN_DIR}' -Force`,
      ],
      { stdio: 'ignore' }
    );
  }

  // O zip traz bin/ffmpeg.exe — achamos e movemos para a raiz de bin/.
  for (const target of TARGETS) {
    if (fs.existsSync(target.path)) continue;

    const match = findFile(BIN_DIR, target.name);
    if (!match) throw new Error(`${target.name} não encontrado dentro do zip`);
    fs.copyFileSync(match, target.path);
  }
}

function tryTar() {
  try {
    execFileSync('tar', ['--version'], { stdio: 'ignore' });
    return 'tar';
  } catch {
    return null;
  }
}

function findFile(root, name, depth = 0) {
  if (depth > 4) return null;

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const found = findFile(full, name, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function main() {
  fs.mkdirSync(BIN_DIR, { recursive: true });

  if (alreadyPresent()) {
    log('FFmpeg já está em bin/ — nada a fazer.');
    return;
  }

  log('procurando FFmpeg instalado no sistema...');
  if (copyFromSystem()) {
    log('copiado do sistema com sucesso.');
    return;
  }

  log('FFmpeg não encontrado no sistema — baixando (aprox. 90MB)...');
  await download(ASSET_URL, ZIP_PATH);
  log('extraindo...');
  extractExecutables();

  fs.rmSync(ZIP_PATH, { force: true });

  for (const target of TARGETS) {
    if (!fs.existsSync(target.path)) {
      throw new Error(`falha ao obter ${target.name}`);
    }
    log(`${target.name}: ${(fs.statSync(target.path).size / 1024 / 1024).toFixed(1)} MB`);
  }

  log('concluído.');
}

main().catch((error) => {
  process.stderr.write(`[fetch-ffmpeg] ERRO: ${error.message}\n`);
  process.exit(1);
});