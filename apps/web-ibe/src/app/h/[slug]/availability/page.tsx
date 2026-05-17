import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  IbeApiError,
  searchAvailability,
  type IbeAvailabilityResponse,
} from '@/lib/api';
import { resolveLocale, t } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    arrival?: string;
    departure?: string;
    adults?: string;
    children?: string;
    lang?: string;
  }>;
}

export default async function AvailabilityPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const lang = resolveLocale(sp);

  const arrival = sp.arrival ?? '';
  const departure = sp.departure ?? '';
  const adults = Number(sp.adults ?? 2);
  const children = Number(sp.children ?? 0);

  if (!arrival || !departure) {
    return <ErrorScreen slug={slug} lang={lang} message={t(lang, 'errors.invalidRange')} />;
  }
  if (arrival >= departure) {
    return <ErrorScreen slug={slug} lang={lang} message={t(lang, 'errors.invalidRange')} />;
  }

  let data: IbeAvailabilityResponse;
  try {
    data = await searchAvailability(slug, { arrival, departure, adults, children });
  } catch (err) {
    if (err instanceof IbeApiError && err.status === 404) notFound();
    return <ErrorScreen slug={slug} lang={lang} message={t(lang, 'errors.fetch')} />;
  }

  const nights = data.results[0]?.nights ?? 1;

  return (
    <>
      <header className="border-b border-aubergine-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href={`/h/${slug}?lang=${lang}`} className="text-sm text-aubergine-700 hover:underline">
            ← {data.property.name}
          </Link>
          <span className="text-[11px] text-aubergine-700/60">
            {arrival} → {departure} · {nights} {t(lang, 'avail.nights')} · {adults + children} {t(lang, 'avail.pax')}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
        <h2 className="text-xl font-semibold text-aubergine-700">{t(lang, 'avail.title')}</h2>

        {data.results.length === 0 ? (
          <p className="mt-6 rounded-xl bg-amber-50 px-4 py-6 text-center text-sm text-amber-900 ring-1 ring-amber-200">
            {t(lang, 'avail.empty')}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {data.results.map((r) => (
              <li
                key={r.roomTypeId}
                className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-aubergine-500">
                      {r.code}
                    </p>
                    <h3 className="text-base font-semibold text-aubergine-700">{r.name}</h3>
                    <p className="mt-1 text-xs text-aubergine-700/60">
                      {t(lang, 'avail.maxOccupancy')} {r.maxOccupancy} {t(lang, 'avail.pax')}
                      {r.available > 0 && (
                        <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                          {r.available}/{r.totalRooms}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-aubergine-700">
                      {Number(r.totalForStay).toFixed(0)} {r.currency}
                    </p>
                    <p className="text-[11px] text-aubergine-700/60">
                      {r.pricePerNight} {r.currency} {t(lang, 'avail.perNight')}
                    </p>
                  </div>
                </div>

                {r.available > 0 && (
                  <BookButton
                    slug={slug}
                    lang={lang}
                    label={t(lang, 'avail.book')}
                    href={`/h/${slug}/book?arrival=${arrival}&departure=${departure}&adults=${adults}&children=${children}&roomTypeId=${r.roomTypeId}&lang=${lang}`}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </main>

      <p className="mb-4 px-4 text-center text-[10px] text-aubergine-700/50">
        {t(lang, 'site.poweredBy')}
      </p>
    </>
  );
}

function BookButton({
  href,
  label,
}: {
  slug: string;
  lang: 'es' | 'en';
  href: string;
  label: string;
}) {
  return (
    <div className="mt-3">
      <Link
        href={href}
        className="inline-block rounded-xl bg-aubergine-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-aubergine-800"
      >
        {label}
      </Link>
    </div>
  );
}

function ErrorScreen({ slug, lang, message }: { slug: string; lang: 'es' | 'en'; message: string }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <p className="rounded-xl bg-rose-50 px-4 py-6 text-sm text-rose-800 ring-1 ring-rose-200">{message}</p>
      <Link href={`/h/${slug}?lang=${lang}`} className="text-sm text-aubergine-700 underline">
        ← {t(lang, 'search.title')}
      </Link>
    </main>
  );
}
