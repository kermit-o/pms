import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import * as forge from 'node-forge';
import type { AuthUser } from '../auth';
import type { PrismaService } from '../db';
import type { Env } from '../config/env.schema';
import { CertificateVaultService } from './certificate-vault.service';
import { SignerService } from './signer.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER: AuthUser = {
  sub: 'user-1',
  tenantId: TENANT,
  email: 'op@hotel.test',
  roles: ['tenant_admin'],
} as unknown as AuthUser;

function buildSelfSignedP12(passphrase: string, cn = 'TEST SIGNER S.L.'): Buffer {
  // 2048 bits — WebCrypto.importKey con RSASSA-PKCS1-v1_5 + SHA-256 rechaza
  // claves más cortas en algunas implementaciones. Bajamos el coste eligiendo
  // exponent 0x10001 (default) y un solo round de generación.
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const attrs = [
    { name: 'commonName', value: cn },
    { name: 'countryName', value: 'ES' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: '3des',
  });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

interface VaultRow {
  id: string;
  subjectCn: string;
  serialNumber: string;
  fingerprintSha256: string;
  notBefore: Date;
  notAfter: Date;
  encryptedBlobPath: string;
  uploadedAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

function makeVault(tmp: string) {
  let row: VaultRow | null = null;

  const tx = {
    verifactuCertificate: {
      findFirst: vi.fn(async () => row),
      upsert: vi.fn(
        async ({
          create,
        }: {
          create: Omit<VaultRow, 'id' | 'uploadedAt' | 'revokedAt' | 'revokedReason'>;
        }) => {
          const next: VaultRow = {
            id: 'cert-1',
            uploadedAt: new Date(),
            revokedAt: null,
            revokedReason: null,
            ...create,
          };
          row = next;
          return { id: next.id, uploadedAt: next.uploadedAt, revokedAt: next.revokedAt };
        },
      ),
      update: vi.fn(),
    },
  };
  const prisma = {
    withTenant: vi.fn(async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>) => fn(tx)),
  } as unknown as PrismaService;
  const config = {
    get: (key: keyof Env) =>
      key === 'VERIFACTU_MASTER_KEY'
        ? 'm'.repeat(40)
        : key === 'VERIFACTU_CERT_DIR'
          ? tmp
          : undefined,
  } as unknown as ConfigService<Env, true>;

  return new CertificateVaultService(prisma, config);
}

async function makeSigner(tmp: string): Promise<SignerService> {
  const vault = makeVault(tmp);
  await vault.upload(USER, 'corr-1', buildSelfSignedP12('pw'), 'pw');
  const signer = new SignerService(vault);
  signer.onModuleInit(); // bootstrap WebCrypto + xmldom
  return signer;
}

describe('SignerService (XAdES-BES vía xadesjs)', () => {
  it('produces a XAdES-BES enveloped signature with two References + QualifyingProperties', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'signer-'));
    try {
      const signer = await makeSigner(tmp);
      const sourceXml = '<Invoice><Header>X</Header><Total>100</Total></Invoice>';
      const result = await signer.sign(TENANT, sourceXml);

      // Signature insertada como hijo del raíz, antes del cierre.
      expect(result.xml).toContain('</Invoice>');
      expect(result.xml).toMatch(/<(ds:)?Signature\b/);

      // XAdES-BES emite DOS Reference: una al doc (URI=""), otra a
      // SignedProperties (URI="#...-SignedProperties").
      const refMatches = result.xml.match(/<(?:ds:)?Reference\b/g) ?? [];
      expect(refMatches.length).toBeGreaterThanOrEqual(2);

      // QualifyingProperties con SignedSignatureProperties + SigningTime +
      // SigningCertificate (puede aparecer como SigningCertificate o
      // SigningCertificateV2 según opciones — verificamos el nombre raíz).
      expect(result.xml).toMatch(/<(xades:)?QualifyingProperties\b/);
      expect(result.xml).toMatch(/<(xades:)?SignedProperties\b/);
      expect(result.xml).toMatch(/<(xades:)?SigningTime\b/);
      expect(result.xml).toMatch(/<(xades:)?SigningCertificate(V2)?\b/);

      // KeyInfo con el cert.
      expect(result.xml).toMatch(/<(ds:)?X509Certificate\b/);
      expect(result.xml).toMatch(/<(ds:)?SignatureValue\b/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 30_000); // RSA-2048 + crypto subtle puede tardar

  it('throws when no certificate has been uploaded for the tenant', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'signer-'));
    try {
      const vault = makeVault(tmp);
      const signer = new SignerService(vault);
      signer.onModuleInit();
      await expect(signer.sign(TENANT, '<X/>')).rejects.toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('throws when the input is not well-formed XML', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'signer-'));
    try {
      const signer = await makeSigner(tmp);
      await expect(signer.sign(TENANT, 'definitely not xml')).rejects.toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 30_000);
});
