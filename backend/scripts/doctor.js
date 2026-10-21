#!/usr/bin/env node
/**
 * Diagnóstico do ambiente — Viral Cut AI
 *
 * Verifica tudo o que pode quebrar antes de rodar:
 *   Node, npm, FFmpeg, FFprobe, banco de dados, variáveis de ambiente,
 *   configuração da IA e da transcrição.
 *
 * Funciona em Windows (PowerShell/CMD), Linux e macOS.
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..');

// Cores ANSI — desabilitadas quando o terminal não suporta.
const supportsColor =
  process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb';

const c = {
  green: (s) => (supportsColor ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s) => (supportsColor ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s) => (supportsColor ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s) => (supportsColor ? `\x1b[36m${s}\x1b[0m` : s),
  dim: (s) => (supportsColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (supportsColor ? `\x1b[1m${s}\x1b[0m` : s),
};

const OK = c.green('✓');
const FAIL = c.red('✗');
const WARN = c.yellow('!');
const DIM = c.dim;

dotenv.config({ path: path.join(BACKEND_ROOT, '.env') });

const results = [];

function run(command, args, options = {}) {
  try {
    return spawnSync(command, args, {
      encoding: 'utf-8',
      // shell:true no Windows quebra scripts com aspas e newlines.
      shell: false,
      timeout: 30000,
      ...options,
    });
  } catch {
    return null;
  }
}

function record(ok, label, detail, hint) {
  results.push({ ok, label, detail, hint });
}

function section(title) {
  console.log(`\n${c.bold(title)}`);
}

// ---------------------------------------------------------------- Node / npm

section('Runtime');

const nodeMajor = Number(process.versions.node.split('.')[0]);
const nodeOk = nodeMajor >= 18;

record(
  nodeOk,
  'Node',
  `${process.versions.node} (Node.js ${process.version})`,
  nodeOk ? null : 'Instale Node.js 18 ou superior: https://nodejs.org'
);
console.log(
  `  ${nodeOk ? OK : FAIL} Node ${DIM(process.version)}${nodeOk ? '' : c.red(' — requer >= 18')}`
);

// No Windows, npm é um script .cmd: precisa ser executado via cmd.exe
// (spawnSync direto de .cmd falha com status null no Node >= 18.20).
const npmCheck =
  process.platform === 'win32'
    ? run('cmd.exe', ['/c', 'npm', '--version'])
    : run('npm', ['--version']);

const npmVersion = npmCheck?.stdout?.trim();
const npmOk = npmCheck?.status === 0 && Boolean(npmVersion);

console.log(`  ${npmOk ? OK : FAIL} npm ${DIM(npmVersion ?? 'não encontrado')}`);
record(npmOk, 'npm', npmVersion ?? null, npmOk ? null : 'Reinstale o Node.js com npm incluso');

// ---------------------------------------------------------------- FFmpeg

section('FFmpeg');

for (const binary of ['ffmpeg', 'ffprobe']) {
  const check = run(binary, ['-version']);
  const found = check?.status === 0;

  const versionLine = (check?.stdout ?? '')
    .split('\n')[0]
    .replace(/^(ffmpeg|ffprobe)\s+version\s*/i, '')
    .split(' ')[0];

  console.log(
    found
      ? `  ${OK} ${binary} ${DIM(versionLine)}`
      : `  ${FAIL} ${binary} não encontrado`
  );

  record(
    found,
    binary,
    found ? versionLine : null,
    found
      ? null
      : binary === 'ffmpeg'
        ? 'Instale o FFmpeg: https://ffmpeg.org/download.html'
        : 'O FFprobe acompanha o FFmpeg — reinstale o pacote completo.'
  );
}

// ---------------------------------------------------------------- Banco

section('Banco de dados');

const databaseUrl = process.env.DATABASE_URL ?? '';
const dbConfigured = databaseUrl.length > 0;

console.log(
  dbConfigured
    ? `  ${OK} DATABASE_URL ${DIM(databaseUrl)}`
    : `  ${FAIL} DATABASE_URL não definida`
);
record(dbConfigured, 'DATABASE_URL', databaseUrl || null, dbConfigured ? null : 'Defina no backend/.env');

// O Prisma resolve caminhos SQLite relativos a pasta do schema (prisma/).
if (dbConfigured && databaseUrl.startsWith('file:')) {
  const dbPath = databaseUrl.replace(/^file:/, '');
  const candidates = [
    path.join(BACKEND_ROOT, dbPath),
    path.join(BACKEND_ROOT, 'prisma', dbPath),
  ];

  const existing = candidates.find((candidate) => existsSync(candidate));

  if (existing) {
    const sizeKb = Math.round(readFileSync(existing).length / 1024);
    console.log(
      `  ${OK} banco SQLite ${DIM(`${path.relative(PROJECT_ROOT, existing)} (${sizeKb} KB)`)}`
    );
    record(true, 'SQLite', path.relative(PROJECT_ROOT, existing), null);
  } else {
    console.log(`  ${WARN} banco ainda não criado — rode: npm run prisma:setup`);
    record(false, 'SQLite', 'pendente', 'npm run prisma:setup');
  }
}

const schemaExists = existsSync(path.join(BACKEND_ROOT, 'prisma', 'schema.prisma'));
console.log(`  ${schemaExists ? OK : FAIL} schema.prisma ${DIM(schemaExists ? '' : 'não encontrado')}`);

// O client do Prisma só existe após `prisma generate`.
const clientExists = existsSync(
  path.join(BACKEND_ROOT, 'node_modules', '.prisma', 'client', 'index.js')
);

console.log(
  clientExists
    ? `  ${OK} Prisma Client gerado`
    : `  ${FAIL} Prisma Client ausente — rode: npm run prisma:setup`
);

record(schemaExists, 'schema.prisma', schemaExists ? 'presente' : 'ausente', schemaExists ? null : 'Rode npm run prisma:setup');
record(clientExists, 'Prisma Client', clientExists ? 'gerado' : 'ausente', clientExists ? null : 'npm run prisma:setup');

// ---------------------------------------------------------------- Ambiente

section('Configuração de ambiente');

const envPath = path.join(BACKEND_ROOT, '.env');
const envExists = existsSync(envPath);

console.log(
  envExists
    ? `  ${OK} arquivo .env ${DIM(path.relative(PROJECT_ROOT, envPath))}`
    : `  ${FAIL} .env ausente — copie de .env.example`
);
record(envExists, '.env', envExists ? 'presente' : 'ausente', envExists ? null : 'cp backend/.env.example backend/.env');

// ---------------------------------------------------------------- IA

section('Análise com IA');

const aiKey = (process.env.AI_API_KEY ?? '').trim();
const aiModel = (process.env.AI_MODEL ?? '').trim();
const aiProvider =
  process.env.AI_PROVIDER?.toLowerCase() ||
  (aiKey.startsWith('gsk_') ? 'groq' : aiKey.startsWith('sk-') ? 'openai' : null);

const aiOk = aiKey.length > 10 && !aiKey.includes('provide');

if (!aiOk) {
  console.log(`  ${FAIL} AI_API_KEY não configurada`);
  console.log(`      ${DIM('Groq (grátis): https://console.groq.com/keys')}`);
  console.log(`      ${DIM('OpenAI:        https://platform.openai.com/api-keys')}`);
  record(false, 'AI_API_KEY', null, 'Defina AI_API_KEY no backend/.env');
} else {
  const masked = `${aiKey.slice(0, 6)}…${aiKey.slice(-4)}`;
  console.log(`  ${OK} AI_API_KEY ${DIM(masked)} ${DIM('(nunca será exibida por completo)')}`);
  record(true, 'AI_API_KEY', masked, null);
}

if (aiOk) {
  console.log(
    aiModel
      ? `  ${OK} AI_MODEL ${DIM(aiModel)}`
      : `  ${WARN} AI_MODEL não definida — usando padrão do provider`
  );
  console.log(`  ${OK} provider ${DIM(aiProvider)}`);

  record(aiModel.length > 0, 'AI_MODEL', aiModel || null, aiModel ? null : 'Defina AI_MODEL no backend/.env');

  // Validação real: uma chamada mínima de chat completion.
  // `/models` não é confiável (muitas chaves não têm permissão de leitura),
  // mas uma chamada de completions prova que a chave E o modelo funcionam.
  const chatEndpoint =
    aiProvider === 'groq'
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';

  console.log(`  ${DIM(`testando ${aiModel} ...`)}`);

  const script = `
fetch('${chatEndpoint}', {
  method: 'POST',
  headers: { Authorization: 'Bearer ${aiKey}', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: ${JSON.stringify(aiModel)},
    messages: [{ role: 'user', content: 'responda apenas: ok' }],
    max_tokens: 5,
  }),
})
  .then(async (r) => {
    const text = await r.text();
    if (!r.ok) {
      let message = 'HTTP ' + r.status;
      try { message = JSON.parse(text).error?.message ?? message; } catch {}
      return process.stdout.write(JSON.stringify({ ok: false, error: message }));
    }
    process.stdout.write(JSON.stringify({ ok: true }));
  })
  .catch((e) => process.stdout.write(JSON.stringify({ ok: false, error: e.message })));
`;

  const probe = run('node', ['-e', script]);

  try {
    const parsed = JSON.parse(probe.stdout?.trim() ?? '{}');

    if (parsed.ok) {
      console.log(`  ${OK} modelo ${DIM(aiModel)} respondeu com sucesso`);
      record(true, 'Modelo de IA', aiModel, null);
    } else {
      console.log(`  ${FAIL} modelo ${c.bold(aiModel)} indisponível: ${parsed.error}`);
      console.log(`      ${DIM(`endpoint: ${chatEndpoint}`)}`);
      console.log(`      ${DIM('Ajuste AI_MODEL no backend/.env para um modelo válido')}`);
      record(false, 'Modelo de IA', aiModel, parsed.error);
    }
  } catch (error) {
    console.log(`  ${WARN} não foi possível validar o modelo (${error.message})`);
    console.log(
      `${DIM('a análise pode falhar se a chave ou o modelo estiverem inválidos')}`
    );
    record(true, 'Modelo de IA', `${aiModel} (não validado)`, null);
  }
}

// ---------------------------------------------------------------- Transcrição

section('Transcrição (Whisper)');

const transcriptionProvider = process.env.TRANSCRIPTION_PROVIDER?.toLowerCase();
const transcriptionKey = (process.env.TRANSCRIPTION_API_KEY ?? '').trim();
const transcriptionModel = process.env.TRANSCRIPTION_MODEL ?? 'whisper-large-v3';

if (transcriptionProvider === 'local') {
  const whisperBinary = run('whisper', ['--help']);
  const localOk = whisperBinary?.status === 0;
  console.log(
    localOk
      ? `  ${OK} Whisper local ${DIM('whisper.cpp encontrado')}`
      : `  ${WARN} provider "local" selecionado, mas whisper.cpp não está no PATH`
  );
  record(localOk, 'Whisper local', localOk ? 'whisper.cpp' : 'não encontrado', localOk ? null : 'Instale whisper.cpp ou use provider groq/openai');
} else {
  const keyOk = transcriptionKey.length > 10 && !transcriptionKey.includes('provide');

  if (!keyOk) {
    console.log(`  ${FAIL} TRANSCRIPTION_API_KEY não configurada`);
    record(false, 'TRANSCRIPTION_API_KEY', null, 'Defina no backend/.env ou use TRANSCRIPTION_PROVIDER=local');
  } else {
    const masked = `${transcriptionKey.slice(0, 6)}…${transcriptionKey.slice(-4)}`;
    const provider =
      transcriptionProvider || (transcriptionKey.startsWith('gsk_') ? 'groq' : 'openai');

    console.log(`  ${OK} TRANSCRIPTION_API_KEY ${DIM(masked)}`);
    console.log(`  ${OK} provider ${DIM(provider)} · modelo ${DIM(transcriptionModel)}`);
    record(true, 'TRANSCRIPTION_API_KEY', masked, null);
  }
}

// ---------------------------------------------------------------- Storage

section('Armazenamento');

for (const dir of ['uploads', 'audio', 'temp', 'results']) {
  const full = path.join(PROJECT_ROOT, 'storage', dir);
  const exists = existsSync(full);

  console.log(
    exists ? `  ${OK} storage/${dir}` : `  ${FAIL} storage/${dir} não existe`
  );
  record(exists, `storage/${dir}`, exists ? 'presente' : 'ausente', exists ? null : 'As pastas são criadas automaticamente ao iniciar o backend');
}

// ---------------------------------------------------------------- Dependências

section('Dependências');

const rootInstalled = existsSync(path.join(PROJECT_ROOT, 'node_modules'));
const frontendInstalled = existsSync(path.join(PROJECT_ROOT, 'frontend', 'node_modules'));
const backendInstalled = existsSync(path.join(BACKEND_ROOT, 'node_modules'));

console.log(`  ${rootInstalled ? OK : WARN} node_modules (raiz)`);
console.log(`  ${frontendInstalled ? OK : WARN} frontend/node_modules`);
console.log(`  ${backendInstalled ? OK : WARN} backend/node_modules`);

if (!backendInstalled) {
  record(false, 'Dependências', 'backend/node_modules ausente', 'npm install');
}

// ---------------------------------------------------------------- Resultado

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
const total = results.length;

console.log(`\n${c.bold('Resumo')}  ${c.green(`${passed}/${total}`)} verificações passaram`);

if (failed.length > 0) {
  console.log(`\n${c.bold('Pendências:')}`);
  for (const item of failed) {
    console.log(`  ${FAIL} ${item.label}${item.hint ? ` — ${item.hint}` : ''}`);
  }

  // Se tudo que falta é configuração opcional, a aplicação ainda sobe.
  const blockers = failed.filter((item) =>
    ['Node', 'npm', 'ffmpeg', 'ffprobe', 'Prisma Client', '.env'].includes(item.label)
  );

  if (blockers.length === 0) {
    console.log(`\n${c.yellow('O backend sobe normalmente.')}`);
    console.log(
      `${DIM('A IA e a transcrição só são exigidas ao analisar um vídeo — configure as chaves para o processamento real.')}`
    );
  } else {
    console.log(`\n${c.red('Corrija as pendências acima antes de iniciar o backend.')}`);
  }
} else {
  console.log(`\n${c.green('Sistema pronto para uso.')} ${DIM('Execute: npm run dev')}`);
}

process.exit(failed.some((item) =>
  ['Node', 'ffmpeg', 'ffprobe', 'Prisma Client'].includes(item.label)
) ? 1 : 0);
