import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, publicOnboardingSetup } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{
    token?: string;
    tenantId?: string;
    email?: string;
    error?: 'fields' | 'terms' | 'api' | 'expired';
  }>;
}

export default async function OnboardingSetupPage({ searchParams }: Props) {
  const sp = await searchParams;
  const token = sp.token ?? '';
  const email = sp.email ?? '';

  if (!token) {
    return (
      <Shell>
        <Banner>El enlace no incluye un token. Reinicia el wizard.</Banner>
        <p className="mt-4 text-sm">
          <Link href="/onboarding" className="underline">
            Volver a empezar
          </Link>
        </p>
      </Shell>
    );
  }

  async function setupAction(formData: FormData) {
    'use server';
    const name = String(formData.get('hotelName') ?? '').trim();
    const city = String(formData.get('city') ?? '').trim();
    const country = String(formData.get('country') ?? 'ES').trim().toUpperCase();
    const timezone = String(formData.get('timezone') ?? 'Europe/Madrid');
    const currency = String(formData.get('currency') ?? 'EUR').toUpperCase();
    const locale = (String(formData.get('locale') ?? 'es-ES') as 'es-ES' | 'en-US');
    const roomsCount = Number(formData.get('roomsCount') ?? 0);
    const fullName = String(formData.get('fullName') ?? '').trim();
    const terms = formData.get('acceptTerms') === 'on';

    if (!name || !city || !fullName || !roomsCount) {
      redirect(
        `/onboarding/setup?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&error=fields`,
      );
    }
    if (!terms) {
      redirect(
        `/onboarding/setup?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&error=terms`,
      );
    }

    try {
      const out = await publicOnboardingSetup({
        token,
        hotel: { name, city, country, timezone, currency, locale, roomsCount },
        admin: { fullName },
        acceptTerms: true,
      });
      redirect(
        `/onboarding/done?tenantId=${encodeURIComponent(out.tenantId)}&adminEmail=${encodeURIComponent(out.adminEmail)}&propertySlug=${encodeURIComponent(out.propertySlug)}&ibeUrl=${encodeURIComponent(out.ibeUrl)}&backofficeUrl=${encodeURIComponent(out.backofficeUrl)}`,
      );
    } catch (err) {
      if (err instanceof ApiError) {
        const reason = err.body.includes('expired') ? 'expired' : 'api';
        redirect(
          `/onboarding/setup?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&error=${reason}`,
        );
      }
      throw err;
    }
  }

  return (
    <Shell>
      <p className="text-sm text-aubergine-700/70">
        Email verificado: <strong>{email}</strong>. Cuéntanos lo básico del hotel y crearemos
        tu instalación.
      </p>

      {sp.error === 'fields' && <Banner>Completa todos los campos obligatorios.</Banner>}
      {sp.error === 'terms' && <Banner>Debes aceptar los términos para continuar.</Banner>}
      {sp.error === 'expired' && (
        <Banner>
          El enlace caducó.{' '}
          <Link href="/onboarding" className="underline">
            Solicita uno nuevo
          </Link>
          .
        </Banner>
      )}
      {sp.error === 'api' && <Banner>Algo falló al crear el hotel. Reintenta.</Banner>}

      <form action={setupAction} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="hotelName" label="Nombre del hotel" required />
          <Field name="city" label="Ciudad" required />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="country" label="País (ISO-2)" defaultValue="ES" maxLength={2} />
          <Field name="timezone" label="Zona horaria" defaultValue="Europe/Madrid" />
          <Field name="currency" label="Divisa" defaultValue="EUR" maxLength={3} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            Idioma
            <select
              name="locale"
              defaultValue="es-ES"
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base font-normal text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
            >
              <option value="es-ES">Español (España)</option>
              <option value="en-US">English (US)</option>
            </select>
          </label>
          <Field
            name="roomsCount"
            type="number"
            min={1}
            max={500}
            label="Nº de habitaciones"
            required
          />
        </div>
        <Field name="fullName" label="Tu nombre completo (admin)" required />

        <label className="flex items-start gap-2 rounded-xl bg-aubergine-50/40 p-3 text-xs text-aubergine-700">
          <input type="checkbox" name="acceptTerms" className="mt-0.5" required />
          <span>
            Acepto los términos de uso y la política de privacidad de Aubergine PMS.
          </span>
        </label>

        <button
          type="submit"
          className="w-full rounded-xl bg-aubergine-700 px-6 py-3 text-base font-semibold text-white transition hover:bg-aubergine-800"
        >
          Crear mi hotel
        </button>
      </form>
    </Shell>
  );
}

function Field({
  name,
  label,
  ...rest
}: { name: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
      {label}
      <input
        name={name}
        {...rest}
        className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base font-normal normal-case text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
      />
    </label>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-aubergine-50 px-6 py-12">
      <div className="w-full max-w-2xl space-y-4 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-aubergine-100">
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">Aubergine</p>
        <h1 className="text-2xl font-semibold text-aubergine-700">Configura tu hotel</h1>
        {children}
      </div>
    </main>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-200">
      {children}
    </div>
  );
}
