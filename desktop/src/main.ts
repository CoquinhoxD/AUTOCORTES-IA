import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Processo principal do Viral Cut AI.
 *
 * Não existe servidor externo: o backend Fastify é iniciado como processo
 * filho dentro do próprio app e serve a API e o build do Vite na mesma
 * porta. O fluxo é sempre:
 *
 *   1. fork do backend  →  2. aguarda "SERVER_READY <porta>" no stdout
 *   3. cria a janela apontando para http://localhost:<porta>
 */

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.VIRAL_CUT_DEV_SERVER_URL ?? 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;
let backend: ChildProcess | null = null;

/** Em dev o backend roda a partir do repo; empacotado, de resources/backend. */
function backendEntry(): string {
  const bundled = path.join(process.resourcesPath, 'backend', 'dist', 'index.js');
  return isDev ? path.resolve(__dirname, '..', '..', 'backend', 'dist', 'index.js') : bundled;
}

function frontendDir(): string | undefined {
  const bundled = path.join(process.resourcesPath, 'web');
  return isDev ? path.resolve(__dirname, '..', '..', 'frontend', 'dist') : bundled;
}

function binDir(): string | undefined {
  return isDev ? undefined : path.join(process.resourcesPath, 'bin');
}

/**
 * Banco SQLite na pasta de dados do usuário.
 *
 * O pacote inclui um `resources/backend/prisma/seed.db` — schema criado, zero
 * linhas — porque o app instalado não roda `prisma db push` (o CLI do Prisma é
 * devDependency e não é empacotado). Sem esse seed a primeira execução
 * falharia com "table does not exist".
 *
 * Copiamos uma única vez; a partir daí o usuário nunca mais perde os dados em
 * uma atualização do instalador. Em dev o backend lê `DATABASE_URL` do `.env`
 * e nada muda.
 */
function ensureDatabase(): string | undefined {
  if (isDev) return undefined;

  const target = path.join(app.getPath('userData'), 'app.db');
  if (!fs.existsSync(target)) {
    const seed = path.join(process.resourcesPath, 'backend', 'prisma', 'seed.db');
    if (!fs.existsSync(seed)) {
      throw new Error(
        `Banco de dados inicial não encontrado no pacote:\n${seed}\n\n` +
          'Reinstale o app — o instalador está incompleto.'
      );
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(seed, target);
  }

  // SQLite aceita caminho absoluto, mas o separador precisa ser "/" mesmo no Windows.
  return `file:${target.replace(/\\/g, '/')}`;
}

/**
 * Inicia o backend e resolve com a porta em que ele passou a escutar.
 * Se o processo sair antes de sinalizar pronto, rejeita com o stderr — sem
 * isso a janela abriria em branco sem explicar o motivo.
 */
function startBackend(): Promise<number> {
  return new Promise((resolve, reject) => {
    const entry = backendEntry();

    if (!fs.existsSync(entry)) {
      reject(
        new Error(
          `Backend não encontrado em:\n${entry}\n\n` +
            'Rode `npm run build` em backend/ antes de abrir o app.'
        )
      );
      return;
    }

    const webDir = frontendDir();
    const bin = binDir();
    const databaseUrl = ensureDatabase();

    const child = fork(entry, [], {
      cwd: isDev ? path.dirname(entry) : path.join(process.resourcesPath, 'backend'),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        // Sem isto o filho roda como um Electron completo em vez de Node:
        // ele perde o single-instance lock e sai em silêncio, sem erro.
        ELECTRON_RUN_AS_NODE: '1',
        VIRAL_CUT_DESKTOP: '1',
        VIRAL_CUT_DATA: app.getPath('userData'),
        ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
        ...(webDir ? { VIRAL_CUT_WEB_DIR: webDir } : {}),
        ...(bin ? { VIRAL_CUT_BIN_DIR: bin } : {}),
        // Porta 0 deixa o sistema escolher uma livre — evita conflito com
        // um servidor de desenvolvimento já rodando na 3000.
        PORT: process.env.PORT ?? '0',
        HOST: '127.0.0.1',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    backend = child;
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('O backend não iniciou a tempo (30s).'));
    }, 30_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      // Log do backend no terminal do dev; no app vai para o console do Windows.
      if (isDev) process.stdout.write(text);

      const match = text.match(/SERVER_READY (\d+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (isDev) process.stderr.write(chunk);
    });

    child.on('exit', (code) => {
      backend = null;
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`O backend encerrou inesperadamente (código ${code}).\n\n${stderr.slice(-800)}`));
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function createWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#09090b',
    title: 'Viral Cut AI',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Evita o "flash" de janela branca antes do React montar.
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Links externos abrem no navegador do sistema, não dentro do app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const target = isDev ? DEV_SERVER_URL : `http://localhost:${port}`;
  void mainWindow.loadURL(target);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function stopBackend(): void {
  if (!backend) return;
  backend.kill();
  backend = null;
}

function showStartupError(message: string): void {
  dialog.showErrorBox('Não foi possível iniciar o Viral Cut AI', message);
  app.quit();
}

// Instância única: abrir o .exe de novo foca a janela existente.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      const port = await startBackend();
      createWindow(port);
    } catch (error) {
      showStartupError(error instanceof Error ? error.message : String(error));
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void app.whenReady();
    });
  });

  app.on('window-all-closed', () => {
    stopBackend();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', stopBackend);
}

/* ------------------------------------------------------------------ */
/* IPC — exposto ao renderer via preload                               */
/* ------------------------------------------------------------------ */

/** Abre o explorador de arquivos e devolve o caminho escolhido. */
ipcMain.handle('dialog:pickVideo', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Selecionar vídeo',
    properties: ['openFile'],
    filters: [
      { name: 'Vídeos', extensions: ['mp4', 'mov', 'webm', 'mkv'] },
      { name: 'Todos os arquivos', extensions: ['*'] },
    ],
  });

  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  dataPath: app.getPath('userData'),
}));
