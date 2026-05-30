import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../auth';
import type { CertificateVaultService, CertificateMetadata } from './certificate-vault.service';
import type { InvoiceService } from './invoice.service';
import { VerifactuController } from './verifactu.controller';

const USER: AuthUser = {
  sub: 'user-1',
  tenantId: '11111111-1111-1111-1111-111111111111',
  email: 'op@hotel.test',
  roles: ['tenant_admin'],
} as unknown as AuthUser;

const REQ = { id: 'corr-1' } as unknown as FastifyRequest;

function makeController(certs: Partial<CertificateVaultService> = {}) {
  const invoices = {} as InvoiceService;
  const certService = certs as CertificateVaultService;
  return new VerifactuController(invoices, certService);
}

const validMeta: CertificateMetadata = {
  id: 'cert-1',
  subjectCn: 'AUBERGINE HOTEL S.L.',
  serialNumber: '01',
  fingerprintSha256: 'a'.repeat(64),
  notBefore: new Date('2025-01-01'),
  notAfter: new Date('2027-01-01'),
  uploadedAt: new Date('2026-01-01'),
  revokedAt: null,
};

describe('VerifactuController · certificate endpoints', () => {
  describe('POST /verifactu/certificate', () => {
    it('rejects body without p12Base64', async () => {
      const ctrl = makeController({ upload: vi.fn() });
      await expect(ctrl.uploadCertificate(USER, REQ, { passphrase: 'x' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects p12Base64 that is too short', async () => {
      const ctrl = makeController({ upload: vi.fn() });
      await expect(
        ctrl.uploadCertificate(USER, REQ, { p12Base64: 'AAAA', passphrase: 'pw' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when decoded p12 is suspiciously small', async () => {
      const ctrl = makeController({ upload: vi.fn() });
      const tooSmall = Buffer.alloc(20).toString('base64');
      // pad p12Base64 so it passes the 100-char min on the string form
      const padded = tooSmall + 'A'.repeat(120);
      await expect(
        ctrl.uploadCertificate(USER, REQ, { p12Base64: padded, passphrase: 'pw' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('forwards a valid payload to the vault service', async () => {
      const upload = vi.fn().mockResolvedValue(validMeta);
      const ctrl = makeController({ upload });
      const fakeBytes = Buffer.alloc(200, 0x42);
      const out = await ctrl.uploadCertificate(USER, REQ, {
        p12Base64: fakeBytes.toString('base64'),
        passphrase: 'pw',
      });
      expect(out).toEqual(validMeta);
      expect(upload).toHaveBeenCalledTimes(1);
      const [u, corr, buf, pw] = upload.mock.calls[0]!;
      expect(u).toBe(USER);
      expect(corr).toBe('corr-1');
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect((buf as Buffer).equals(fakeBytes)).toBe(true);
      expect(pw).toBe('pw');
    });
  });

  describe('GET /verifactu/certificate', () => {
    it('returns metadata when present', async () => {
      const ctrl = makeController({ getMetadata: vi.fn().mockResolvedValue(validMeta) });
      await expect(ctrl.getCertificate(USER, REQ)).resolves.toEqual(validMeta);
    });

    it('throws NotFound when no certificate exists', async () => {
      const ctrl = makeController({ getMetadata: vi.fn().mockResolvedValue(null) });
      await expect(ctrl.getCertificate(USER, REQ)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('DELETE /verifactu/certificate', () => {
    it('rejects bodies without a reason', async () => {
      const ctrl = makeController({ revoke: vi.fn() });
      await expect(ctrl.revokeCertificate(USER, REQ, {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects too-short reasons', async () => {
      const ctrl = makeController({ revoke: vi.fn() });
      await expect(ctrl.revokeCertificate(USER, REQ, { reason: 'no' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('forwards reason to the vault service', async () => {
      const revoke = vi.fn().mockResolvedValue({ id: 'cert-1', revokedAt: new Date() });
      const ctrl = makeController({ revoke });
      await ctrl.revokeCertificate(USER, REQ, { reason: 'compromised' });
      expect(revoke).toHaveBeenCalledWith(USER, 'corr-1', 'compromised');
    });
  });
});
