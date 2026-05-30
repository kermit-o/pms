import { describe, expect, it } from 'vitest';
import { decryptCertificate, encryptCertificate } from './certificate-crypto';

const MASTER = 'x'.repeat(40); // ≥32 chars per env.schema constraint
const TENANT = '11111111-1111-1111-1111-111111111111';
const PLAINTEXT = Buffer.from('pretend-this-is-a-p12-blob', 'utf-8');

describe('certificate-crypto', () => {
  it('round-trips encrypt → decrypt', () => {
    const blob = encryptCertificate(MASTER, TENANT, PLAINTEXT);
    const back = decryptCertificate(MASTER, TENANT, blob);
    expect(back.equals(PLAINTEXT)).toBe(true);
  });

  it('produces a different ciphertext each call (random IV)', () => {
    const a = encryptCertificate(MASTER, TENANT, PLAINTEXT);
    const b = encryptCertificate(MASTER, TENANT, PLAINTEXT);
    expect(a.equals(b)).toBe(false);
  });

  it('fails on wrong master key (auth tag mismatch)', () => {
    const blob = encryptCertificate(MASTER, TENANT, PLAINTEXT);
    expect(() => decryptCertificate('y'.repeat(40), TENANT, blob)).toThrow();
  });

  it('fails on wrong tenant id (different derived key)', () => {
    const blob = encryptCertificate(MASTER, TENANT, PLAINTEXT);
    expect(() =>
      decryptCertificate(MASTER, '22222222-2222-2222-2222-222222222222', blob),
    ).toThrow();
  });

  it('fails on truncated blob', () => {
    expect(() => decryptCertificate(MASTER, TENANT, Buffer.alloc(5))).toThrow();
  });
});
