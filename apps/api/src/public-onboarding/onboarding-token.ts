import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Token autocontenido para el wizard de onboarding (Sprint 9 W3).
 *
 * Formato: `base64url(payload).base64url(hmac)`. El payload lleva
 * `kind`, `email`, opcionalmente `tenantId`, `iat`, `exp` y un `nonce` que
 * sirve de identificador único para idempotencia/audit.
 *
 * Sin JWT lib externa — `node:crypto` cubre todo. Si en el futuro el
 * payload crece o necesitamos rotación de claves, migramos a `jose`.
 */
export type OnboardingTokenKind = 'verify' | 'setup';

export interface OnboardingTokenPayload {
  kind: OnboardingTokenKind;
  email: string;
  tenantId?: string;
  iat: number;
  exp: number;
  nonce: string;
}

export function signOnboardingToken(
  payload: Omit<OnboardingTokenPayload, 'iat' | 'nonce'>,
  secret: string,
): { token: string; full: OnboardingTokenPayload } {
  const full: OnboardingTokenPayload = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    nonce: randomBytes(8).toString('hex'),
  };
  const body = b64u(Buffer.from(JSON.stringify(full)));
  const sig = b64u(createHmac('sha256', secret).update(body).digest());
  return { token: `${body}.${sig}`, full };
}

export interface OnboardingTokenVerifyOk {
  ok: true;
  payload: OnboardingTokenPayload;
}
export interface OnboardingTokenVerifyErr {
  ok: false;
  reason: 'malformed' | 'bad_signature' | 'expired';
}
export type OnboardingTokenVerify = OnboardingTokenVerifyOk | OnboardingTokenVerifyErr;

export function verifyOnboardingToken(
  token: string,
  secret: string,
): OnboardingTokenVerify {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts as [string, string];
  const expected = b64u(createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }
  let payload: OnboardingTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload };
}

function b64u(buf: Buffer): string {
  return buf.toString('base64url');
}
