import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, publicOnboardingVerify } from '@/lib/api';

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
      return (
        <Shell>
          <Banner kind="error">
            {reason === 'expired'
              ? 'El enlace caducó. Solicita uno nuevo.'
              : reason === 'invalid'
              ? 'El enlace no es válido. Solicita uno nuevo.'
              : 'No pudimos verificar el enlace. Reintenta.'}
          </Banner>
          <p className="mt-4 text-sm">
            <Link href="/onboarding" className="underline">
              Solicitar otro enlace
            </Link>
          </p>
        </Shell>
      );
    }
    throw err;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-aubergine-50 px-6 py-12">
      <div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-aubergine-100">
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">Aubergine</p>
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
