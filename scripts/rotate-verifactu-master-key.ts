/**
 * Rotación de VERIFACTU_MASTER_KEY (ADR-030 §3, RUNBOOK §6.2).
 *
 * Lee todos los blobs cifrados en `verifactu_certificates.encrypted_blob_path`,
 * los descifra con la clave VIEJA y los re-cifra con la NUEVA. Tras éxito:
 *   1. Cambias VERIFACTU_MASTER_KEY al valor nuevo en el .env de la API.
 *   2. Reinicias la API.
 *
 * Uso (desde la raíz del monorepo):
 *
 *   VERIFACTU_MASTER_KEY_OLD="<vieja>" \
 *   VERIFACTU_MASTER_KEY_NEW="<nueva>" \
 *   DIRECT_URL="postgres://..." \
 *     pnpm tsx scripts/rotate-verifactu-master-key.ts [--dry-run]
 *
 * Garantías:
 *   - Atomicidad por fichero: escribe a `.p12.enc.tmp` y rename().
 *   - No toca la DB (solo lee). Si algo falla por la mitad, los blobs no
 *     re-cifrados quedan intactos y la rotación se puede reintentar
 *     idempotentemente (la nueva escritura sobrescribe la temp).
 *   - Si falla en MEDIO de la operación (algunos blobs re-cifrados con
 *     nueva, otros aún con vieja), **no rotes la env var** hasta que el
 *     script termine sin errores: ambos estados coexisten correctamente
 *     porque cada blob solo se descifra con UNA key.
 *
 * **Pre-flight obligatorio**: backup completo de VERIFACTU_CERT_DIR antes
 * de ejecutar. Si los blobs nuevos quedan corruptos, sin backup no hay
 * recuperación — los .p12 originales no se almacenan.
 */
import { existsSync, renameSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  decryptCertificate,
  encryptCertificate,
} from '../apps/api/src/verifactu/certificate-crypto';

const envCandidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
for (const path of envCandidates) {
  if (existsSync(path)) {
    loadDotenv({ path });
    break;
  }
}

const oldKey = process.env.VERIFACTU_MASTER_KEY_OLD;
const newKey = process.env.VERIFACTU_MASTER_KEY_NEW;
const dryRun = process.argv.includes('--dry-run');

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

if (!oldKey || oldKey.length < 32) {
  fail('VERIFACTU_MASTER_KEY_OLD obligatoria (≥ 32 chars).');
}
if (!newKey || newKey.length < 32) {
  fail('VERIFACTU_MASTER_KEY_NEW obligatoria (≥ 32 chars).');
}
if (oldKey === newKey) {
  fail('VERIFACTU_MASTER_KEY_OLD y _NEW son iguales — nada que rotar.');
}

const adminUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!adminUrl) fail('DIRECT_URL o DATABASE_URL obligatoria.');

const prisma = new PrismaClient({ datasources: { db: { url: adminUrl } } });

interface Outcome {
  tenantId: string;
  path: string;
  status: 'ok' | 'skipped-revoked' | 'error';
  error?: string;
}

async function rotateOne(
  tenantId: string,
  path: string,
  revokedAt: Date | null,
): Promise<Outcome> {
  // Saltamos certs revocados — no se usarán nunca más, no merece la pena
  // re-cifrarlos. Quedan accesibles solo con la key vieja para auditoría.
  if (revokedAt) {
    return { tenantId, path, status: 'skipped-revoked' };
  }
  try {
    const blob = await readFile(path);
    const plain = decryptCertificate(oldKey!, tenantId, blob);
    const reEnc = encryptCertificate(newKey!, tenantId, plain);

    if (dryRun) {
      return { tenantId, path, status: 'ok' };
    }

    // Escritura atómica: tmp → rename. Si crash a mitad, el original sigue.
    const tmpPath = `${path}.tmp`;
    await writeFile(tmpPath, reEnc, { mode: 0o600 });
    renameSync(tmpPath, path);
    return { tenantId, path, status: 'ok' };
  } catch (err) {
    return {
      tenantId,
      path,
      status: 'error',
      error: (err as Error).message,
    };
  }
}

async function main(): Promise<void> {
  const certs = await prisma.verifactuCertificate.findMany({
    select: { tenantId: true, encryptedBlobPath: true, revokedAt: true },
  });

  console.log(
    `rotate-verifactu-master-key: ${certs.length} certificate(s) found${dryRun ? ' [DRY RUN]' : ''}`,
  );

  const outcomes: Outcome[] = [];
  for (const cert of certs) {
    const o = await rotateOne(cert.tenantId, cert.encryptedBlobPath, cert.revokedAt);
    outcomes.push(o);
    const tag = o.status === 'ok' ? 'OK' : o.status === 'skipped-revoked' ? 'SKIP' : 'ERR';
    console.log(`  [${tag}] tenant=${o.tenantId} path=${o.path}${o.error ? ` err=${o.error}` : ''}`);
  }

  const ok = outcomes.filter((o) => o.status === 'ok').length;
  const skipped = outcomes.filter((o) => o.status === 'skipped-revoked').length;
  const errored = outcomes.filter((o) => o.status === 'error').length;
  console.log(
    `\nSummary: ${ok} rotated, ${skipped} skipped (revoked), ${errored} errored.${
      dryRun ? ' (DRY RUN — no files were written)' : ''
    }`,
  );

  await prisma.$disconnect();

  if (errored > 0) {
    console.error(
      'Some certificates failed to rotate. DO NOT change VERIFACTU_MASTER_KEY ' +
        'in the API .env until you investigate and re-run successfully.',
    );
    process.exit(2);
  }

  if (!dryRun) {
    console.log(
      '\nNext steps:\n' +
        '  1. Backup VERIFACTU_CERT_DIR ahora mismo (los blobs llevan la NUEVA key).\n' +
        '  2. Actualiza VERIFACTU_MASTER_KEY en el .env de la API a la nueva.\n' +
        '  3. Reinicia la API.\n' +
        '  4. Verifica que un test de firma e2e pasa con un tenant que ya rotó.',
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
