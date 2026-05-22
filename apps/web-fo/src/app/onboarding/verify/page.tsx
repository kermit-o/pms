import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, publicOnboardingStart, publicOnboardingVerify } from '@/lib/api';
import { OnboardingStepper } from '../stepper';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ token?: string }>;
}

export default async function OnboardingVerifyPage({ searchParams }: Props) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <Shell>
        <Banner kind="error">El enlace no incluye un token. Reinicia el wizard.</Banner>
        <p className="mt-4 text-sm">
          <Link href="/onboarding" className="underline">
            Volver a empezar
          </Link>
        </p>
      </Shell>
    );
  }

  try {
    const out = await publicOnboardingVerify(token);
    redirect(
      `/onboarding/setup?token=${encodeURIComponent(out.setupToken)}&tenantId=${encodeURIComponent(out.tenantId)}&email=${encodeURIComponent(out.email)}`,
    );
  } catch (err) {
    if (err instanceof ApiError) {
      const reason =
        err.body.includes('expired') ? 'expired' : err.body.includes('signature') ? 'invalid' : 'failed';

      // Sprint 13 W3 — recuperación tras 24h: si el link caducó, parseamos
      // el email del payload (es un JWT no firmado por nosotros una vez
      // caducado, pero el formato sigue siendo `header.payload.signature`
      // base64-url) para preofrecer el reenvío sin reescribirlo.
      const emailFromToken = tryExtractEmailFromToken(token);

      async function resendAction(formData: FormData) {
        'use server';
        const email = String(formData.get('email') ?? '').trim().toLowerCase();
        if (!email || !email.includes('@')) {
          redirect('/onboarding?status=email_missing');
        }
        try {
          await publicOnboardingStart({ email, locale: 'es' });
          redirect(`/onboarding?status=sent&email=${encodeURIComponent(email)}`);
        } catch {
          redirect(`/onboarding?status=failed&email=${encodeURIComponent(email)}`);
        }
      }

      return (
        <Shell>
          <Banner kind="error">
            {reason === 'expired'
              ? 'El enlace caducó. Pídenos uno nuevo abajo y revisa tu bandeja.'
              : reason === 'invalid'
                ? 'El enlace no es válido. Solicita uno nuevo.'
                : 'No pudimos verificar el enlace. Reintenta.'}
          </Banner>
          <form action={resendAction} className="mt-4 space-y-3">
            <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
              Email
              <input
                name="email"
                type="email"
                required
                defaultValue={emailFromToken ?? ''}
                placeholder="tu@hotel.es"
                className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
              />
            </label>
            <button
              type="submit"
              className="w-full rounded-xl bg-aubergine-700 px-6 py-3 text-base font-semibold text-white hover:bg-aubergine-800"
            >
              Reenviar enlace
            </button>
          </form>
          <p className="mt-3 text-xs text-aubergine-700/60">
            ¿Prefieres empezar de cero?{' '}
            <Link href="/onboarding" className="underline">
              Volver al inicio
            </Link>
            .
          </p>
        </Shell>
      );
    }
    throw err;
  }
}

/** Sprint 13 W3 — Extrae el email del payload base64-url del JWT del verify
 *  link. NO valida la firma (eso lo hace el backend); sólo lee el campo
 *  para prerellenar el form de reenvío tras expiración. Devuelve null si
 *  no se puede parsear (token corrupto). */
function tryExtractEmailFromToken(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1] ?? '';
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    if (typeof json?.email === 'string' && json.email.includes('@')) return json.email;
    return null;
  } catch {
    return null;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-aubergine-50 px-6 py-12">
      <div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-aubergine-100">
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">Aubergine</p>
        <OnboardingStepper current="email" />
        <h1 className="text-2xl font-semibold text-aubergine-700">Verifica tu email</h1>
        {children}
      </div>
    </main>
  );
}

function Banner({ kind, children }: { kind: 'error'; children: React.ReactNode }) {
  void kind;
  return (
    <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-200">
      {children}
    </div>
  );
}
