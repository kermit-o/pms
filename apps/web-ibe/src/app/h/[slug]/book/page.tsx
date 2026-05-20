import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Turnstile } from '@/components/turnstile';
import { createReservation, IbeApiError } from '@/lib/api';
import { resolveLocale, t } from '@/lib/i18n';
import { TURNSTILE_SITE_KEY } from '@/lib/turnstile';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    arrival?: string;
    departure?: string;
    adults?: string;
    children?: string;
    roomTypeId?: string;
    lang?: string;
    error?: string;
  }>;
}

export default async function BookPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const lang = resolveLocale(sp);

  const arrival = sp.arrival ?? '';
  const departure = sp.departure ?? '';
  const adults = Number(sp.adults ?? 2);
  const children = Number(sp.children ?? 0);
  const roomTypeId = sp.roomTypeId ?? '';

  if (!arrival || !departure || !roomTypeId) {
    redirect(`/h/${encodeURIComponent(slug)}?lang=${lang}`);
  }

  async function submit(formData: FormData) {
    'use server';
    const firstName = String(formData.get('firstName') ?? '').trim();
    const lastName = String(formData.get('lastName') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim();
    const phone = String(formData.get('phone') ?? '').trim() || undefined;
    const nationality = String(formData.get('nationality') ?? '').trim() || undefined;
    const gdpr = formData.get('gdprConsent') === 'on';
    const marketing = formData.get('marketingConsent') === 'on';
    const specialRequests = String(formData.get('specialRequests') ?? '').trim() || undefined;
    const turnstileToken = String(formData.get('turnstileToken') ?? '').trim() || undefined;

    if (!firstName || !lastName || !email) {
      redirect(
        `/h/${slug}/book?arrival=${arrival}&departure=${departure}&adults=${adults}&children=${children}&roomTypeId=${roomTypeId}&lang=${lang}&error=fields`,
      );
    }
    if (!gdpr) {
      redirect(
        `/h/${slug}/book?arrival=${arrival}&departure=${departure}&adults=${adults}&children=${children}&roomTypeId=${roomTypeId}&lang=${lang}&error=gdpr`,
      );
    }
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      redirect(
        `/h/${slug}/book?arrival=${arrival}&departure=${departure}&adults=${adults}&children=${children}&roomTypeId=${roomTypeId}&lang=${lang}&error=captcha`,
      );
    }

    try {
      const out = await createReservation(slug, {
        arrival,
        departure,
        roomTypeId,
        occupancy: { adults, children },
        guest: {
          firstName,
          lastName,
          email,
          phone,
          nationality,
          gdprConsent: true,
          marketingConsent: marketing,
        },
        specialRequests,
        turnstileToken,
      });
      redirect(`/h/${slug}/book/${out.code}?lang=${lang}&lastName=${encodeURIComponent(lastName)}`);
    } catch (err) {
      if (err instanceof IbeApiError) {
        const reason = err.status === 403 ? 'captcha' : err.status === 429 ? 'rate' : 'api';
        redirect(
          `/h/${slug}/book?arrival=${arrival}&departure=${departure}&adults=${adults}&children=${children}&roomTypeId=${roomTypeId}&lang=${lang}&error=${reason}`,
        );
      }
      throw err;
    }
  }

  return (
    <>
      <header className="border-b border-aubergine-100 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            href={`/h/${slug}/availability?arrival=${arrival}&departure=${departure}&adults=${adults}&children=${children}&lang=${lang}`}
            className="text-sm text-aubergine-700 hover:underline"
          >
            ← {t(lang, 'avail.title')}
          </Link>
          <span className="text-[11px] text-aubergine-700/60">
            {arrival} → {departure}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
        <h2 className="text-xl font-semibold text-aubergine-700">
          {lang === 'es' ? 'Tus datos' : 'Your details'}
        </h2>

        {sp.error && (
          <div className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-800 ring-1 ring-rose-200">
            {sp.error === 'gdpr' && (lang === 'es' ? 'Necesitamos tu consentimiento RGPD para procesar la reserva.' : 'We need your GDPR consent to process the booking.')}
            {sp.error === 'fields' && (lang === 'es' ? 'Faltan campos obligatorios.' : 'Required fields are missing.')}
            {sp.error === 'captcha' && (lang === 'es' ? 'Completa la verificación anti-spam antes de continuar.' : 'Please complete the anti-spam check before continuing.')}
            {sp.error === 'rate' && (lang === 'es' ? 'Demasiados intentos. Espera unos minutos.' : 'Too many attempts. Try again in a few minutes.')}
            {sp.error === 'api' && t(lang, 'errors.fetch')}
          </div>
        )}

        <form action={submit} className="mt-4 space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="firstName" label={lang === 'es' ? 'Nombre' : 'First name'} required />
            <Field name="lastName" label={lang === 'es' ? 'Apellido' : 'Last name'} required />
          </div>
          <Field name="email" label="Email" type="email" required />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="phone" label={lang === 'es' ? 'Teléfono (opc.)' : 'Phone (opt.)'} />
            <Field
              name="nationality"
              label={lang === 'es' ? 'Nacionalidad (ISO-2, opc.)' : 'Nationality (ISO-2, opt.)'}
              maxLength={2}
            />
          </div>
          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            {lang === 'es' ? 'Comentarios (opc.)' : 'Comments (opt.)'}
            <textarea
              name="specialRequests"
              rows={3}
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base font-normal normal-case text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
            />
          </label>

          <div className="space-y-2 rounded-xl bg-aubergine-50/40 p-3 text-xs text-aubergine-700">
            <label className="flex items-start gap-2">
              <input type="checkbox" name="gdprConsent" required className="mt-0.5" />
              <span>
                {lang === 'es'
                  ? 'Acepto que el hotel trate mis datos para gestionar la reserva (obligatorio RGPD).'
                  : 'I consent to the hotel processing my data to manage this booking (GDPR required).'}
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="marketingConsent" className="mt-0.5" />
              <span>
                {lang === 'es'
                  ? 'Quiero recibir ofertas y promociones (opcional).'
                  : 'I want to receive offers and promotions (optional).'}
              </span>
            </label>
          </div>

          <Turnstile siteKey={TURNSTILE_SITE_KEY} />

          <button
            type="submit"
            className="w-full rounded-xl bg-aubergine-700 px-6 py-3 text-base font-semibold text-white transition hover:bg-aubergine-800"
          >
            {lang === 'es' ? 'Confirmar reserva' : 'Confirm booking'}
          </button>
        </form>
      </main>
    </>
  );
}

function Field({
  label,
  name,
  ...rest
}: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
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
