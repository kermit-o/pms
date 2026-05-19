import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, publicOnboardingStart } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ status?: 'sent' | 'failed' | 'email_missing'; email?: string }>;
}

export default async function OnboardingLanding({ searchParams }: Props) {
  const sp = await searchParams;

  async function startAction(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const locale = (formData.get('locale') === 'en' ? 'en' : 'es') as 'es' | 'en';
    if (!email || !email.includes('@')) {
      redirect('/onboarding?status=email_missing');
    }
    try {
      const out = await publicOnboardingStart({ email, locale });
      redirect(`/onboarding?status=sent&email=${encodeURIComponent(out.email)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        redirect(`/onboarding?status=failed&email=${encodeURIComponent(email)}`);
      }
      throw err;
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-aubergine-50 px-6 py-12">
      <div className="w-full max-w-lg space-y-6 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-aubergine-100">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">Aubergine</p>
          <h1 className="text-2xl font-semibold text-aubergine-700">Crea tu hotel</h1>
          <p className="text-sm text-aubergine-700/70">
            Te enviamos un email con un enlace para confirmar tu correo. Después
            configurarás los datos básicos del hotel.
          </p>
        </header>

        {sp.status === 'sent' && (
          <Banner kind="success">
            Email enviado a <strong>{sp.email}</strong>. Revisa tu bandeja (también spam).
          </Banner>
        )}
        {sp.status === 'failed' && (
          <Banner kind="error">
            No pudimos enviar el email. Reintenta en unos minutos o usa otro proveedor.
          </Banner>
        )}
        {sp.status === 'email_missing' && (
          <Banner kind="error">Introduce un email válido.</Banner>
        )}

        <form action={startAction} className="space-y-4">
          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            Email del responsable
            <input
              name="email"
              type="email"
              required
              defaultValue={sp.email}
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base font-normal normal-case text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
            />
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            Idioma
            <select
              name="locale"
              defaultValue="es"
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base font-normal text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
            >
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
          </label>
          <button
            type="submit"
            className="w-full rounded-xl bg-aubergine-700 px-6 py-3 text-base font-semibold text-white transition hover:bg-aubergine-800"
          >
            Enviarme el enlace
          </button>
        </form>

        <p className="text-xs text-aubergine-700/60">
          ¿Ya tienes una cuenta?{' '}
          <Link href="/login" className="underline">
            Inicia sesión
          </Link>
          .
        </p>
      </div>
    </main>
  );
}

function Banner({ kind, children }: { kind: 'success' | 'error'; children: React.ReactNode }) {
  const cls =
    kind === 'success'
      ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
      : 'bg-rose-50 text-rose-900 ring-rose-200';
  return <div className={`rounded-xl px-4 py-3 text-sm ring-1 ${cls}`}>{children}</div>;
}
