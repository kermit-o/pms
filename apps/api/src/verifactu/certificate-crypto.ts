import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

/**
 * Cifrado simétrico de los .p12 de tenant. ADR-030 §3.
 *
 * - Algoritmo: AES-256-GCM (authenticated, single-pass).
 * - Clave: derivada de VERIFACTU_MASTER_KEY + tenantId vía PBKDF2-HMAC-SHA256
 *   con 100k iteraciones (OWASP 2024 baseline). El tenantId actúa como salt
 *   por-tenant, lo que evita cross-tenant rainbow tables aún si la master key
 *   se filtra (limitadamente — sigue siendo crítica).
 * - Layout del blob: [12B IV][16B authTag][N B ciphertext].
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha256';

function deriveKey(masterKey: string, tenantId: string): Buffer {
  return pbkdf2Sync(masterKey, tenantId, PBKDF2_ITERATIONS, KEY_BYTES, PBKDF2_DIGEST);
}

export function encryptCertificate(masterKey: string, tenantId: string, plaintext: Buffer): Buffer {
  const key = deriveKey(masterKey, tenantId);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export function decryptCertificate(masterKey: string, tenantId: string, blob: Buffer): Buffer {
  if (blob.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('Encrypted blob is too short');
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);

  const key = deriveKey(masterKey, tenantId);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
