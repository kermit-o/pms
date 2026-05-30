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
  const keys = forge.pki.rsa.generateKeyPair(1024);
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
    withTenant: vi.fn(async <T,>(_ctx: unknown, fn: (tx: unknown) => Promise<T>) => fn(tx)),
  } as unknown as PrismaService;
  const config = {
    get: (key: keyof Env) =>
      key === 'VERIFACTU_MASTER_KEY' ? 'm'.repeat(40) : key === 'VERIFACTU_CERT_DIR' ? tmp : undefined,
  } as unknown as ConfigService<Env, true>;

  return new CertificateVaultService(prisma, config);
}

function extractBetween(s: string, start: string, end: string): string {
  const i = s.indexOf(start);
  const j = s.indexOf(end, i + start.length);
  if (i < 0 || j < 0) throw new Error(`Could not extract between ${start}…${end}`);
  return s.slice(i + start.length, j);
}

describe('SignerService', () => {
  it('produces a verifiable RSA-SHA256 enveloped signature', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'signer-'));
    try {
      const vault = makeVault(tmp);
      await vault.upload(USER, 'corr-1', buildSelfSignedP12('pw'), 'pw');

      const signer = new SignerService(vault);
      const sourceXml = '<Invoice><Header>X</Header><Total>100</Total></Invoice>';
      const result = await signer.sign(TENANT, sourceXml);

      // Sanity: la firma se insertó como último hijo del raíz.
      expect(result.xml.endsWith('</Invoice>')).toBe(true);
      expect(result.xml.includes('<ds:Signature')).toBe(true);
      expect(result.xml.indexOf('<ds:Signature')).toBeGreaterThan(
        result.xml.indexOf('<Total>'),
      );

      // 1. El digest de la Reference debe coincidir con SHA-256 del XML
      //    original (transformación enveloped sobre un doc sin firma previa
      //    = identity).
      const md = forge.md.sha256.create();
      md.update(sourceXml, 'utf8');
      const expectedDigest = forge.util.encode64(md.digest().bytes());
      const refDigest = extractBetween(result.xml, '<ds:DigestValue>', '</ds:DigestValue>');
      expect(refDigest).toBe(expectedDigest);
      expect(refDigest).toBe(result.digestValue);

      // 2. La SignatureValue debe verificar contra SignedInfo + clave pública
      //    del certificado declarado.
      const signedInfo =
        '<ds:SignedInfo' +
        extractBetween(result.xml, '<ds:SignedInfo', '</ds:SignedInfo>') +
        '</ds:SignedInfo>';
      const sigValue = extractBetween(
        result.xml,
        '<ds:SignatureValue>',
        '</ds:SignatureValue>',
      );
      const certB64 = extractBetween(
        result.xml,
        '<ds:X509Certificate>',
        '</ds:X509Certificate>',
      );
      const certDer = forge.util.decode64(certB64);
      const cert = forge.pki.certificateFromAsn1(
        forge.asn1.fromDer(forge.util.createBuffer(certDer)),
      );
      const verifyMd = forge.md.sha256.create();
      verifyMd.update(signedInfo, 'utf8');
      const ok = (cert.publicKey as forge.pki.rsa.PublicKey).verify(
        verifyMd.digest().bytes(),
        forge.util.decode64(sigValue),
      );
      expect(ok).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('throws when no certificate has been uploaded for the tenant', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'signer-'));
    try {
      const vault = makeVault(tmp);
      const signer = new SignerService(vault);
      await expect(signer.sign(TENANT, '<X/>')).rejects.toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('refuses to sign an empty XML (no closing tag)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'signer-'));
    try {
      const vault = makeVault(tmp);
      await vault.upload(USER, 'corr-1', buildSelfSignedP12('pw'), 'pw');
      const signer = new SignerService(vault);
      await expect(signer.sign(TENANT, 'not xml')).rejects.toThrow(/closing tag/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
