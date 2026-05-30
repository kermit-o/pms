import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as forge from 'node-forge';
import type { AuthUser } from '../auth';
import type { PrismaService } from '../db';
import type { Env } from '../config/env.schema';
import { CertificateVaultService } from './certificate-vault.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER: AuthUser = {
  sub: 'user-1',
  tenantId: TENANT,
  email: 'op@hotel.test',
  roles: ['tenant_admin'],
} as unknown as AuthUser;

function buildSelfSignedP12(passphrase: string, cn = 'TEST HOTEL S.L.'): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(1024); // fast for tests
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const attrs = [
    { name: 'commonName', value: cn },
    { name: 'countryName', value: 'ES' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: '3des',
  });
  const der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(der, 'binary');
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

function makeService(opts: {
  certDir: string;
  masterKey?: string;
  initialRow?: VaultRow | null;
}) {
  let row: VaultRow | null = opts.initialRow ?? null;

  const tx = {
    verifactuCertificate: {
      findFirst: vi.fn(async () => row),
      upsert: vi.fn(async ({ create }: { create: Omit<VaultRow, 'id' | 'uploadedAt' | 'revokedAt' | 'revokedReason'> }) => {
        row = {
          id: 'cert-1',
          uploadedAt: new Date(),
          revokedAt: null,
          revokedReason: null,
          ...create,
        };
        return { id: row.id, uploadedAt: row.uploadedAt, revokedAt: row.revokedAt };
      }),
      update: vi.fn(async ({ data }: { data: Partial<VaultRow> }) => {
        if (!row) throw new Error('no row');
        row = { ...row, ...data };
        return row;
      }),
    },
  };
  const prisma = {
    withTenant: vi.fn(async <T,>(_ctx: unknown, fn: (tx: unknown) => Promise<T>) => fn(tx)),
  } as unknown as PrismaService;

  const config = {
    get: (key: keyof Env) =>
      key === 'VERIFACTU_MASTER_KEY' ? opts.masterKey : key === 'VERIFACTU_CERT_DIR' ? opts.certDir : undefined,
  } as unknown as ConfigService<Env, true>;

  return {
    service: new CertificateVaultService(prisma, config),
    getRow: () => row,
    tx,
  };
}

describe('CertificateVaultService', () => {
  it('refuses upload when VERIFACTU_MASTER_KEY is missing', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vault-'));
    try {
      const { service } = makeService({ certDir: tmp });
      await expect(
        service.upload(USER, 'corr-1', buildSelfSignedP12('pw'), 'pw'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects an invalid p12 / wrong passphrase', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vault-'));
    try {
      const { service } = makeService({ certDir: tmp, masterKey: 'm'.repeat(40) });
      await expect(
        service.upload(USER, 'corr-1', buildSelfSignedP12('correct'), 'wrong'),
      ).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('uploads, persists metadata, and round-trips a passphrase-less p12', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vault-'));
    try {
      const { service, getRow } = makeService({ certDir: tmp, masterKey: 'm'.repeat(40) });
      const p12 = buildSelfSignedP12('pw', 'AUBERGINE HOTEL S.L.');

      const meta = await service.upload(USER, 'corr-1', p12, 'pw');
      expect(meta.subjectCn).toBe('AUBERGINE HOTEL S.L.');
      expect(meta.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(meta.notAfter.getTime()).toBeGreaterThan(Date.now());

      const row = getRow();
      expect(row).not.toBeNull();
      const onDisk = readFileSync(row!.encryptedBlobPath);
      expect(onDisk.length).toBeGreaterThan(12 + 16); // IV + tag + 1
      expect(onDisk.equals(p12)).toBe(false); // not plaintext

      // El blob descifrado ya NO está protegido por la passphrase original
      // (ADR-030 §3 — el vault es el único límite de confidencialidad).
      const back = await service.loadDecryptedP12(TENANT);
      const asn1 = forge.asn1.fromDer(forge.util.createBuffer(back.toString('binary')));
      const pfx = forge.pkcs12.pkcs12FromAsn1(asn1, false, null as unknown as string);
      const certBagOid = forge.pki.oids.certBag as string;
      const cert = pfx.getBags({ bagType: certBagOid })[certBagOid]?.[0]?.cert;
      expect(cert).toBeDefined();
      const cn = (cert!.subject.attributes as Array<{ shortName?: string; value?: unknown }>)
        .find((a) => a.shortName === 'CN')?.value?.toString();
      expect(cn).toBe('AUBERGINE HOTEL S.L.');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('loadDecryptedP12 throws when no certificate exists for the tenant', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vault-'));
    try {
      const { service } = makeService({ certDir: tmp, masterKey: 'm'.repeat(40) });
      await expect(service.loadDecryptedP12(TENANT)).rejects.toBeInstanceOf(NotFoundException);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('loadDecryptedP12 refuses revoked certificates', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vault-'));
    try {
      const { service } = makeService({
        certDir: tmp,
        masterKey: 'm'.repeat(40),
        initialRow: {
          id: 'cert-1',
          subjectCn: 'X',
          serialNumber: '1',
          fingerprintSha256: 'a'.repeat(64),
          notBefore: new Date(),
          notAfter: new Date(Date.now() + 1e9),
          encryptedBlobPath: join(tmp, 'irrelevant.p12.enc'),
          uploadedAt: new Date(),
          revokedAt: new Date(),
          revokedReason: 'lost',
        },
      });
      await expect(service.loadDecryptedP12(TENANT)).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('revoke() marks the existing row as revoked', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vault-'));
    try {
      const { service, getRow } = makeService({ certDir: tmp, masterKey: 'm'.repeat(40) });
      await service.upload(USER, 'corr-1', buildSelfSignedP12('pw'), 'pw');
      const r = await service.revoke(USER, 'corr-2', 'compromised');
      expect(r.revokedAt).toBeInstanceOf(Date);
      expect(getRow()?.revokedReason).toBe('compromised');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
