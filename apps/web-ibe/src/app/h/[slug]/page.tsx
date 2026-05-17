import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProperty, IbeApiError, type IbeProperty } from '@/lib/api';
import { resolveLocale, t, LOCALES } from '@/lib/i18n';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const property = await getProperty(slug);
    return {
      title: property.name,
      description: `Reserva directa en ${property.name}.`,
    };
  } catch {
    return { title: 'Hotel no encontrado' };
  }
}

export default async function HotelHomePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const lang = resolveLocale(sp);

  let property: IbeProperty;
  try {
    property = await getProperty(slug);
  } catch (err) {
    if (err instanceof IbeApiError && err.status === 404) notFound();
    throw err;
  }

  const today = new Date();
  const minArrival = today.toISOString().slice(0, 10);
  const defaultDeparture = new Date(today);
  defaultDeparture.setUTCDate(defaultDeparture.getUTCDate() + 2);
  const minDeparture = defaultDeparture.toISOString().slice(0, 10);

  // Schema.org Hotel markup
  const hotelSchema = {
    '@context': 'https://schema.org',
    '@type': 'Hotel',
    name: property.name,
    address: { '@type': 'PostalAddress', addressCountry: 'ES' },
    priceRange: '€€',
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(hotelSchema) }}
      />

      <Header property={property} lang={lang} slug={slug} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100">
          <h2 className="text-xl font-semibold text-aubergine-700">
            {t(lang, 'search.title')}
          </h2>

          <form
            action={`/h/${encodeURIComponent(slug)}/availability`}
            method="get"
            className="mt-4 grid gap-3 sm:grid-cols-2"
          >
            <input type="hidden" name="lang" value={lang} />
            <Field
              label={t(lang, 'search.arrival')}
              name="arrival"
              type="date"
              min={minArrival}
              defaultValue={minArrival}
            />
            <Field
              label={t(lang, 'search.departure')}
              name="departure"
              type="date"
              min={minDeparture}
              defaultValue={minDeparture}
            />
            <Field label={t(lang, 'search.adults')} name="adults" type="number" min={1} max={10} defaultValue={2} />
            <Field label={t(lang, 'search.children')} name="children" type="number" min={0} max={10} defaultValue={0} />

            <button
              type="submit"
              className="col-span-1 mt-2 rounded-xl bg-aubergine-700 px-6 py-3 text-base font-semibold text-white transition hover:bg-aubergine-800 sm:col-span-2"
            >
              {t(lang, 'search.cta')}
            </button>
          </form>
        </section>

        <p className="mt-6 text-center text-xs text-aubergine-700/50">
          <Link href={`/h/${slug}/manage?lang=${lang}`} className="underline">
            {t(lang, 'manage.title')}
          </Link>
        </p>
      </main>

      <Footer lang={lang} />
    </>
  );
}

function Header({ property, lang, slug }: { property: IbeProperty; lang: 'es' | 'en'; slug: string }) {
  return (
    <header className="border-b border-aubergine-100 bg-white">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-aubergine-500">
            {t(lang, 'site.tagline')}
          </p>
          <h1 className="text-lg font-semibold text-aubergine-700">{property.name}</h1>
        </div>
        <nav className="flex items-center gap-2 text-xs">
          {LOCALES.map((l) => (
            <Link
              key={l}
              href={`/h/${encodeURIComponent(slug)}?lang=${l}`}
              className={`rounded-full px-2 py-1 ${
                l === lang
                  ? 'bg-aubergine-700 text-white'
                  : 'bg-aubergine-50 text-aubergine-700 hover:bg-aubergine-100'
              }`}
            >
              {l.toUpperCase()}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

function Footer({ lang }: { lang: 'es' | 'en' }) {
  return (
    <footer className="mt-auto border-t border-aubergine-100 bg-white py-4 text-center text-[10px] text-aubergine-700/60">
      <p>
        {t(lang, 'site.poweredBy')} ·{' '}
        <span className="opacity-70">
          {t(lang, 'footer.legal')} · {t(lang, 'footer.privacy')}
        </span>
      </p>
    </footer>
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
        required
        {...rest}
        className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base font-normal normal-case text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
      />
    </label>
  );
}
