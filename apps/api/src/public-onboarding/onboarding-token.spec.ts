import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  signOnboardingToken,
  verifyOnboardingToken,
} from './onboarding-token';

const SECRET = 'a'.repeat(64);

afterEach(() => vi.useRealTimers());

describe('onboarding-token', () => {
  it('signs and verifies a valid token', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const { token, full } = signOnboardingToken(
      { kind: 'verify', email: 'a@b.test', exp },
      SECRET,
    );
    const out = verifyOnboardingToken(token, SECRET);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.payload.email).toBe('a@b.test');
      expect(out.payload.kind).toBe('verify');
      expect(out.payload.nonce).toBe(full.nonce);
    }
  });

  it('rejects when secret does not match', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const { token } = signOnboardingToken(
      { kind: 'verify', email: 'a@b', exp },
      SECRET,
    );
    const out = verifyOnboardingToken(token, 'z'.repeat(64));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('bad_signature');
  });

  it('rejects malformed tokens', () => {
    expect(verifyOnboardingToken('abc', SECRET)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyOnboardingToken('a.b', SECRET).ok).toBe(false);
  });

  it('rejects expired tokens', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const exp = Math.floor(Date.now() / 1000) + 60;
    const { token } = signOnboardingToken(
      { kind: 'setup', email: 'a@b', tenantId: 't-1', exp },
      SECRET,
    );
    vi.setSystemTime(new Date('2026-01-01T01:00:00Z'));
    const out = verifyOnboardingToken(token, SECRET);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('expired');
  });

  it('detects bit-flip tampering', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const { token } = signOnboardingToken(
      { kind: 'verify', email: 'a@b', exp },
      SECRET,
    );
    const parts = token.split('.');
    const tampered = `${parts[0]!.slice(0, -1)}X.${parts[1]}`;
    const out = verifyOnboardingToken(tampered, SECRET);
    expect(out.ok).toBe(false);
  });
});
