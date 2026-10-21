#!/usr/bin/env node
/**
 * Limpeza de artefatos gerados — seguro para rodar em qualquer SO.
 *
 * Remove:
 *   - build outputs (backend/dist, frontend/dist)
 *   - caches de build (.tsbuildinfo)
 *   - áudio temporário em storage/audio e storage/temp
 *   - resultados de teste com cobertura
 *
 * NÃO remove:
 *   - vídeos originais em storage/uploads
 *   - banco de dados
 *   - node_modules
 */

import { rmSync, existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SAFE_TO_REMOVE = [
  'backend/dist',
  'frontend/dist',
  'backend/coverage',
  'frontend/coverage',
  'backend/*.tsbuildinfo',
  'frontend/*.tsbuildinfo',
];

const TEMP_STORAGE = ['storage/audio', 'storage/temp'];

let removed = 0;
let freedBytes = 0;

function dirSize(dir) {
  if (!existsSync(dir)) return 0;

  let stats;
  try {
    stats = statSync(dir);
  } catch {
    return 0;
  }

  // Arquivo solto — não é diretório.
  if (!stats.isDirectory()) return stats.size;

  let total = 0;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    // Pode ser um link ou algo removido no meio da varredura.
    return 0;
  }

  for (const entry of entries) {
    total += dirSize(path.join(dir, entry));
  }
  return total;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function remove(target) {
  const full = path.resolve(ROOT, target);
  if (!full.startsWith(ROOT)) return; // proteção contra path traversal

  if (!existsSync(full)) return;

  const size = dirSize(full);
  try {
    rmSync(full, { recursive: true, force: true });
    removed++;
    freedBytes += size;
    console.log(`  ✓ ${target} ${formatSize(size)}`);
  } catch (error) {
    console.log(`  ✗ ${target} — ${error.message}`);
  }
}

function removeContents(dir) {
  const full = path.resolve(ROOT, dir);
  if (!full.startsWith(ROOT) || !existsSync(full)) return;

  for (const entry of readdirSync(full)) {
    // Preserva o .gitkeep que mantém a pasta no Git
    if (entry === '.gitkeep') continue;
    remove(path.join(dir, entry));
  }
}

console.log('\nLimpando artefatos de build...');
for (const target of SAFE_TO_REMOVE) remove(target);

console.log('\nLimpando temporários de mídia...');
for (const dir of TEMP_STORAGE) removeContents(dir);

console.log(
  `\n${removed} item(ns) removido(s), ${formatSize(freedBytes)} liberados.`
);
console.log('storage/uploads preservado — vídeos originais não são apagados.\n');
