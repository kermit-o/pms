import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getReservation, IbeApiError } from '@/lib/api';
import { resolveLocale, t } from '@/lib/i18n';
import { StripeCardCapture } from './stripe-card-capture';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string; code: string }>;
  searchParams: Promise<{ lang?: string; lastName?: string }>;
}

export default async function ConfirmationPage({ params, searchParams }: Props) {
  const { slug, code } = await params;
  const sp = await searchParams;
  const lang = resolveLocale(sp);
  const lastName = sp.lastName ?? '';

  if (!lastName) {
    notFound();
  }

  let view;
  try {
    view = await getReservation(slug, code, lastName);
  } catch (err) {
    if (err instanceof IbeApiError && err.status === 404) notFound();
    throw err;
  }

  // Schema.org LodgingReservation
  const reservationSchema = {
    '@context': 'https://schema.org',
    '@type': 'LodgingReservation',
    reservationNumber: view.code,
    reservationStatus: `https://schema.org/${
      view.status === 'CANCELLED' ? 'ReservationCancelled' : 'ReservationConfirmed'
    }`,
    underName: {
      '@type': 'Person',
      name: `${view.guest.firstName} ${view.guest.lastName}`,
    },
    checkinTime: view.arrival,
    checkoutTime: view.departure,
    totalPrice: { '@type': 'PriceSpecification', price: view.totalAmount, priceCurrency: view.currency },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(reservationSchema) }}
      />

      <header className="border-b border-aubergine-100 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href={`/h/${slug}?lang=${lang}`} className="text-sm text-aubergine-700 hover:underline">
            ← Aubergine
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
        <section className="rounded-2xl bg-emerald-50 px-6 py-5 ring-1 ring-emerald-200">
          <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-700">
            {lang === 'es' ? 'Reserva confirmada' : 'Booking confirmed'}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-emerald-900">{view.code}</h2>
          <p className="mt-2 text-sm text-emerald-900/80">
            {lang === 'es' ? 'Te hemos enviado un email a' : 'We sent an email to'}{' '}
            <strong>{view.guest.email}</strong>.
          </p>
        </section>

        <section className="mt-5 grid gap-4 sm:grid-cols-2">
          <Stat label={lang === 'es' ? 'Llegada' : 'Check-in'} value={view.arrival} />
          <Stat label={lang === 'es' ? 'Salida' : 'Check-out'} value={view.departure} />
          <Stat label={lang === 'es' ? 'Tipo' : 'Room type'} value={`${view.roomType.code} · ${view.roomType.name}`} />
          <Stat label={lang === 'es' ? 'Total' : 'Total'} value={`${view.totalAmount} ${view.currency}`} />
        </section>

        {view.status === 'CONFIRMED' && (
          <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100">
            <h3 className="text-sm font-semibold text-aubergine-700">
              {lang === 'es' ? 'Asegura tu reserva (opcional)' : 'Secure your booking (optional)'}
            </h3>
            <p className="mt-1 text-xs text-aubergine-700/70">
              {lang === 'es'
                ? 'Tu tarjeta nunca toca nuestros servidores. La tokeniza Stripe directamente. Sólo se usa como garantía y para los servicios extra que añadas in situ.'
                : 'Your card never touches our servers. Stripe tokenises it directly. Used only as guarantee and for extras you add on-site.'}
            </p>
            <div className="mt-3">
              <StripeCardCapture slug={slug} code={view.code} lastName={lastName} lang={lang} />
            </div>
          </section>
        )}

        {view.cancellationPolicy && (
          <section className="mt-6 rounded-2xl bg-aubergine-50/60 p-4 text-xs text-aubergine-700">
            <p className="font-semibold uppercase tracking-wide">
              {lang === 'es' ? 'Política de cancelación' : 'Cancellation policy'}
            </p>
            <p className="mt-1">{view.cancellationPolicy}</p>
          </section>
        )}

        <p className="mt-6 text-center text-[10px] text-aubergine-700/50">
          <Link href={`/h/${slug}/manage?lang=${lang}`} className="underline">
            {t(lang, 'manage.title')}
          </Link>
        </p>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-aubergine-100">
      <p className="text-[10px] uppercase tracking-wide text-aubergine-500">{label}</p>
      <p className="mt-1 text-base font-semibold text-aubergine-700">{value}</p>
    </div>
  );
}
