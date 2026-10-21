import path from 'node:path';
import fs from 'node:fs';

/**
 * Resolve a raiz do projeto de forma determinística, sem depender de
 * `import.meta` (que quebra sob transpilação CommonJS em testes).
 *
 * Estratégia: a partir do diretório de execução (cwd), sobe os níveis
 * procurando o marcador `package.json` do backend. Se o processo foi
 * iniciado de outro lugar, cai para o dirname do módulo.
 */
function findBackendRoot(): string {
  let current = process.cwd();

  for (let i = 0; i < 6; i++) {
    const packageJsonPath = path.join(current, 'package.json');

    if (fs.existsSync(packageJsonPath)) {
      try {
        const content = fs.readFileSync(packageJsonPath, 'utf-8');
        if (content.includes('"viral-cut-ai-backend"')) {
          return current;
        }
      } catch {
        // ignora erros de leitura e continua subindo
      }
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Fallback: assume que estamos em backend/ (comportamento dos npm scripts)
  return path.join(process.cwd(), 'backend');
}

export const BACKEND_ROOT = findBackendRoot();

/**
 * Raiz de dados no app desktop. O Electron define VIRAL_CUT_DATA para
 * apontar para `userData` — assim banco, vídeos e config sobrevivem a
 * atualizações do instalador. Em dev, cai para a pasta storage do projeto.
 */
const DATA_ROOT = process.env.VIRAL_CUT_DATA
  ? path.resolve(process.env.VIRAL_CUT_DATA)
  : path.resolve(BACKEND_ROOT, '..', 'storage');

export const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..');
export const STORAGE_ROOT = DATA_ROOT;

export const PATHS = {
  root: PROJECT_ROOT,
  backend: BACKEND_ROOT,
  data: DATA_ROOT,
  storage: DATA_ROOT,
  uploads: path.join(DATA_ROOT, 'uploads'),
  audio: path.join(DATA_ROOT, 'audio'),
  temp: path.join(DATA_ROOT, 'temp'),
  results: path.join(DATA_ROOT, 'results'),
} as const;

export function ensureStorageDirs(): void {
  for (const key of ['uploads', 'audio', 'temp', 'results'] as const) {
    fs.mkdirSync(PATHS[key], { recursive: true });
  }
}