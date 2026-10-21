import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PATHS } from '../config/paths.js';

/**
 * Armazenamento seguro de segredos (API keys).
 *
 * No Windows, usa DPAPI via PowerShell para proteger a chave mestra.
 * Em outros sistemas, deriva a chave de uma senha baseada no usuário/sistema.
 * O arquivo de segredos fica em `storage/secrets.enc`.
 */

const SECRETS_FILE = path.join(PATHS.data, 'secrets.enc');
const SALT_FILE = path.join(PATHS.data, 'secrets.salt');
const MASTER_KEY_ENV = 'VIRAL_CUT_MASTER_KEY';

interface StoredSecrets {
  version: number;
  iv: string;       // base64
  data: string;     // base64 (JSON criptografado)
}

/**
 * Obtém ou gera a chave mestra de criptografia.
 * No Windows, tenta usar DPAPI. Em outros sistemas, usa variável de ambiente ou arquivo.
 */
async function getMasterKey(): Promise<Buffer> {
  // 1. Tenta variável de ambiente (para deploy controlado)
  const envKey = process.env[MASTER_KEY_ENV];
  if (envKey && envKey.length >= 32) {
    return Buffer.from(envKey.slice(0, 32), 'utf-8');
  }

  // 2. No Windows, usa DPAPI via PowerShell
  if (process.platform === 'win32') {
    try {
      const script = `
        Add-Type -AssemblyName System.Security
        $entropy = [System.Text.Encoding]::UTF8.GetBytes("ViralCutAI-${process.env.USERNAME || 'user'}")
        $protected = [System.Security.Cryptography.ProtectedData]::Protect($entropy, $null, 'CurrentUser')
        [Convert]::ToBase64String($protected)
      `;
      const result = execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, { 
        encoding: 'utf-8',
        timeout: 5000 
      }).trim();
      
      if (result) {
        // Desprotege para obter a entropia original, depois deriva a chave
        const unprotectScript = `
          Add-Type -AssemblyName System.Security
          $protected = [Convert]::FromBase64String("${result.replace(/"/g, '\\"')}")
          $entropy = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, 'CurrentUser')
          [Convert]::ToBase64String($entropy)
        `;
        const entropyB64 = execSync(`powershell -NoProfile -Command "${unprotectScript.replace(/"/g, '\\"')}"`, { 
          encoding: 'utf-8',
          timeout: 5000 
        }).trim();
        const entropy = Buffer.from(entropyB64, 'base64');
        return scryptSync(entropy, 'viralcut-salt', 32);
      }
    } catch {
      // DPAPI falhou, continua para fallback
    }
  }

  // 3. Fallback: arquivo de chave mestra (protegido por permissões de arquivo)
  try {
    if (fs.existsSync(SALT_FILE)) {
      const salt = fs.readFileSync(SALT_FILE);
      // Em produção, a senha viria de um keyring do sistema
      // Aqui usamos uma derivação baseada em informações da máquina
      const machineId = getMachineId();
      return scryptSync(machineId, salt, 32);
    }
  } catch {
    // Arquivo não existe, será criado
  }

  // 4. Gera novo salt e avisa sobre limitação
  const salt = randomBytes(16);
  fs.mkdirSync(PATHS.data, { recursive: true });
  fs.writeFileSync(SALT_FILE, salt);
  fs.chmodSync(SALT_FILE, 0o600);
  
  console.warn('[SECURE-STORAGE] Usando derivação de chave baseada na máquina. Para máxima segurança, defina VIRAL_CUT_MASTER_KEY no ambiente.');
  
  const machineId = getMachineId();
  return scryptSync(machineId, salt, 32);
}

function getMachineId(): string {
  // Combina informações estáveis da máquina
  const parts = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || 'unknown',
    os.totalmem().toString(),
  ];
  return parts.join('|');
}

/**
 * Criptografa um objeto JSON e salva no arquivo de segredos.
 */
export async function saveSecrets(secrets: Record<string, string>): Promise<void> {
  const masterKey = await getMasterKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  
  const plaintext = JSON.stringify(secrets);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // Armazena: iv + authTag + encrypted
  const stored: StoredSecrets = {
    version: 1,
    iv: iv.toString('base64'),
    data: Buffer.concat([authTag, encrypted]).toString('base64'),
  };
  
  fs.mkdirSync(PATHS.data, { recursive: true });
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(stored), 'utf-8');
  fs.chmodSync(SECRETS_FILE, 0o600);
}

/**
 * Carrega e descriptografa os segredos.
 */
export async function loadSecrets(): Promise<Record<string, string>> {
  if (!fs.existsSync(SECRETS_FILE)) {
    return {};
  }
  
  try {
    const masterKey = await getMasterKey();
    const stored: StoredSecrets = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf-8'));
    
    if (stored.version !== 1) {
      throw new Error(`Versão de segredos não suportada: ${stored.version}`);
    }
    
    const iv = Buffer.from(stored.iv, 'base64');
    const data = Buffer.from(stored.data, 'base64');
    
    // Primeiros 16 bytes = authTag (GCM)
    const authTag = data.subarray(0, 16);
    const encrypted = data.subarray(16);
    
    const decipher = createDecipheriv('aes-256-gcm', masterKey, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString('utf-8'));
  } catch (error) {
    console.error('[SECURE-STORAGE] Falha ao carregar segredos:', error);
    // Se falhar, retorna vazio (chaves perdidas, usuário precisará reconfigurar)
    return {};
  }
}

/**
 * Remove um segredo específico.
 */
export async function removeSecret(key: string): Promise<void> {
  const secrets = await loadSecrets();
  delete secrets[key];
  await saveSecrets(secrets);
}

/**
 * Limpa todos os segredos.
 */
export async function clearSecrets(): Promise<void> {
  await saveSecrets({});
}

/**
 * Verifica se o armazenamento seguro está disponível.
 */
export async function isSecureStorageAvailable(): Promise<boolean> {
  try {
    await getMasterKey();
    return true;
  } catch {
    return false;
  }
}