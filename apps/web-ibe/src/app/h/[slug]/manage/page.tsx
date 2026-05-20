import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Turnstile } from '@/components/turnstile';
import {
  cancelReservation,
  getReservation,
  IbeApiError,
  resendConfirmation,
  type IbeReservationView,
} from '@/lib/api';
import { resolveLocale, t } from '@/lib/i18n';
import { TURNSTILE_SITE_KEY } from '@/lib/turnstile';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    code?: string;
    lastName?: string;
    lang?: string;
    status?:
      | 'cancelled'
      | 'cancel_needs_accept'
      | 'cancel_fail'
      | 'cancel_captcha'
      | 'resent'
      | 'resend_fail'
      | 'resend_captcha'
      | 'lookup_fail';
    penalty?: string;
    currency?: string;
  }>;
}

export default async function ManagePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const lang = resolveLocale(sp);
  const code = sp.code?.trim() ?? '';
  const lastName = sp.lastName?.trim() ?? '';

  // Server actions
  async function lookupAction(formData: FormData) {
    'use server';
    const c = String(formData.get('code') ?? '').trim();
    const ln = String(formData.get('lastName') ?? '').trim();
    if (!c || !ln) {
      redirect(`/h/${slug}/manage?lang=${lang}&status=lookup_fail`);
    }
    redirect(`/h/${slug}/manage?lang=${lang}&code=${encodeURIComponent(c)}&lastName=${encodeURIComponent(ln)}`);
  }

  async function cancelAction(formData: FormData) {
    'use server';
    const accept = formData.get('acceptPenalty') === 'on';
    const turnstileToken = String(formData.get('turnstileToken') ?? '').trim() || undefined;
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      redirect(
        `/h/${slug}/manage?lang=${lang}&code=${encodeURIComponent(code)}&lastName=${encodeURIComponent(lastName)}&status=cancel_captcha`,
      );
    }
    try {
      const out = await cancelReservation(slug, code, lastName, accept, turnstileToken);
      redirect(
        `/h/${slug}/manage?lang=${lang}&code=${encodeURIComponent(code)}&lastName=${encodeURIComponent(lastName)}&status=cancelled&penalty=${out.penalty}&currency=${out.currency}`,
      );
    } catch (err) {
      if (err instanceof IbeApiError && err.status === 409) {
        redirect(
          `/h/${slug}/manage?lang=${lang}&code=${encodeURIComponent(code)}&lastName=${encodeURIComponent(lastName)}&status=cancel_needs_accept`,
        );
      }
      if (err instanceof IbeApiError && err.status === 403) {
        redirect(
          `/h/${slug}/manage?lang=${lang}&code=${encodeURIComponent(code)}&lastName=${encodeURIComponent(lastName)}&status=cancel_captcha`,
        );
      }
      redirect(
        `/h/${slug}/manage?lang=${lang}&code=${encodeURIComponent(code)}&lastName=${encodeURIComponent(lastName)}&status=cancel_fail`,
      );
    }
  }

  async function resendAction(formData: FormData) {
    'use server';
    const turnstileToken = String(formData.get('turnstileToken') ?? '').trim() || undefined;
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      redirect(
        `/h/${slug}/manage?lang=${lang}&code=${encodeURIComponent(code)}&lastName=${encodeURIComponent(lastName)}&status=resend_captcha`,
      );
    }
    try {
      await resendConfirmation(slug, code, lastName, turnstileToken);
      redirect(
        `/h/${slug}/manage?lang=${lang}&code=${encodeURIComponent(code)}&lastName=${encodeURIComponent(lastName)}&status=resent`,
      );
    } catch (err) {
      if (err instanceof IbeApiError && err.status === 403) {
        redirect(
          `/h/${slug}/manage?lang=${lang}&code=${encodeURIComponent(code)}&lastName=${encodeURIComponent(lastName)}&status=resend_captcha`,
        );
      }
      redirect(
        `/h/${slug}/manage?lang=${lang}&code=${encodeURIComponent(code)}&lastName=${encodeURIComponent(lastName)}&status=resend_fail`,
      );
    }
  }

  // Si no hay code+lastName, mostrar form de búsqueda.
  if (!code || !lastName) {
    return (
      <Shell slug={slug} lang={lang}>
        <h2 className="text-xl font-semibold text-aubergine-700">
          {t(lang, 'manage.title')}
        </h2>
        {sp.status === 'lookup_fail' && (
          <Banner kind="error">
            {lang === 'es' ? 'Faltan campos obligatorios.' : 'Required fields are missing.'}
          </Banner>
        )}
        <form action={lookupAction} className="mt-4 space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100">
          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            {t(lang, 'manage.code')}
            <input
              name="code"
              required
              defaultValue={code}
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base font-normal normal-case text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
            />
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            {t(lang, 'manage.lastName')}
            <input
              name="lastName"
              required
              defaultValue={lastName}
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base font-normal normal-case text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-xl bg-aubergine-700 px-6 py-3 text-base font-semibold text-white transition hover:bg-aubergine-800"
          >
            {t(lang, 'manage.lookup')}
          </button>
        </form>
      </Shell>
    );
  }

  let view: IbeReservationView;
  try {
    view = await getReservation(slug, code, lastName);
  } catch (err) {
    const notFound = err instanceof IbeApiError && err.status === 404;
    return (
      <Shell slug={slug} lang={lang}>
        <Banner kind="error">
          {notFound
            ? lang === 'es'
              ? 'No encontramos esa reserva con esos datos.'
              : "We can't find that booking with the data you entered."
            : t(lang, 'errors.fetch')}
        </Banner>
        <p className="mt-4 text-center">
          <Link
            href={`/h/${slug}/manage?lang=${lang}`}
            className="text-sm text-aubergine-700 underline"
          >
            ← {lang === 'es' ? 'Volver a buscar' : 'Search again'}
          </Link>
        </p>
      </Shell>
    );
  }

  return (
    <Shell slug={slug} lang={lang}>
      {sp.status === 'cancelled' && (
        <Banner kind="success">
          {lang === 'es' ? 'Reserva cancelada.' : 'Booking cancelled.'}
          {sp.penalty && Number(sp.penalty) > 0 && (
            <>
              {' '}
              {lang === 'es' ? 'Penalización aplicada:' : 'Penalty applied:'}{' '}
              <strong>
                {sp.penalty} {sp.currency}
              </strong>
              .
            </>
          )}
        </Banner>
      )}
      {sp.status === 'cancel_needs_accept' && (
        <Banner kind="warn">
          {lang === 'es'
            ? 'La cancelación implica penalización. Confirma debajo para aceptarla.'
            : 'Cancellation has a penalty. Accept it below to confirm.'}
        </Banner>
      )}
      {sp.status === 'cancel_fail' && <Banner kind="error">{t(lang, 'errors.fetch')}</Banner>}
      {(sp.status === 'cancel_captcha' || sp.status === 'resend_captcha') && (
        <Banner kind="warn">
          {lang === 'es'
            ? 'Completa la verificación anti-spam antes de continuar.'
            : 'Please complete the anti-spam check before continuing.'}
        </Banner>
      )}
      {sp.status === 'resent' && (
        <Banner kind="success">
          {lang === 'es' ? 'Email de confirmación reenviado.' : 'Confirmation email resent.'}
        </Banner>
      )}
      {sp.status === 'resend_fail' && <Banner kind="error">{t(lang, 'errors.fetch')}</Banner>}

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100">
        <p className="text-[10px] uppercase tracking-[0.3em] text-aubergine-500">
          {t(lang, 'manage.title')}
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-aubergine-700">{view.code}</h2>
        <p className="mt-1 text-sm text-aubergine-700/70">
          {view.guest.firstName} {view.guest.lastName}
          {view.guest.email && <span> · {view.guest.email}</span>}
        </p>
        <span
          className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle(view.status)}`}
        >
          {view.status.toLowerCase().replace(/_/g, ' ')}
        </span>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2">
        <Stat label={lang === 'es' ? 'Llegada' : 'Check-in'} value={view.arrival} />
        <Stat label={lang === 'es' ? 'Salida' : 'Check-out'} value={view.departure} />
        <Stat label={lang === 'es' ? 'Tipo' : 'Room type'} value={`${view.roomType.code} · ${view.roomType.name}`} />
        <Stat label={lang === 'es' ? 'Total' : 'Total'} value={`${view.totalAmount} ${view.currency}`} />
      </section>

      {view.cancellationPolicy && (
        <section className="mt-4 rounded-xl bg-aubergine-50/60 p-3 text-xs text-aubergine-700">
          <p className="font-semibold uppercase tracking-wide">
            {lang === 'es' ? 'Política de cancelación' : 'Cancellation policy'}
          </p>
          <p className="mt-1">{view.cancellationPolicy}</p>
        </section>
      )}

      <section className="mt-6 flex flex-col gap-3 sm:flex-row">
        <form action={resendAction} className="sm:flex-1 space-y-2">
          <Turnstile siteKey={TURNSTILE_SITE_KEY} />
          <button
            type="submit"
            className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-aubergine-700 ring-1 ring-aubergine-200 hover:bg-aubergine-50"
          >
            {lang === 'es' ? 'Reenviar email de confirmación' : 'Resend confirmation email'}
          </button>
        </form>

        {view.cancellable && (
          <form action={cancelAction} className="sm:flex-1 space-y-2 rounded-xl bg-rose-50 p-3 ring-1 ring-rose-200">
            <label className="flex items-start gap-2 text-xs text-rose-900">
              <input type="checkbox" name="acceptPenalty" className="mt-0.5" />
              <span>
                {lang === 'es'
                  ? 'Acepto la penalización si aplica.'
                  : 'I accept the penalty if any.'}
              </span>
            </label>
            <Turnstile siteKey={TURNSTILE_SITE_KEY} />
            <button
              type="submit"
              className="w-full rounded-xl bg-rose-700 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-800"
            >
              {lang === 'es' ? 'Cancelar reserva' : 'Cancel booking'}
            </button>
          </form>
        )}
      </section>

      <p className="mt-6 text-center">
        <Link href={`/h/${slug}/manage?lang=${lang}`} className="text-xs text-aubergine-700 underline">
          {lang === 'es' ? 'Buscar otra reserva' : 'Look up another booking'}
        </Link>
      </p>
    </Shell>
  );
}

function Shell({
  slug,
  lang,
  children,
}: {
  slug: string;
  lang: 'es' | 'en';
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="border-b border-aubergine-100 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href={`/h/${slug}?lang=${lang}`} className="text-sm text-aubergine-700 hover:underline">
            ← Aubergine
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </>
  );
}

function Banner({ kind, children }: { kind: 'success' | 'warn' | 'error'; children: React.ReactNode }) {
  const cls = {
    success: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
    warn: 'bg-amber-50 text-amber-900 ring-amber-200',
    error: 'bg-rose-50 text-rose-900 ring-rose-200',
  }[kind];
  return <div className={`mb-4 rounded-xl px-4 py-3 text-sm ring-1 ${cls}`}>{children}</div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-aubergine-100">
      <p className="text-[10px] uppercase tracking-wide text-aubergine-500">{label}</p>
      <p className="mt-1 text-base font-semibold text-aubergine-700">{value}</p>
    </div>
  );
}

function statusStyle(status: string): string {
  switch (status) {
    case 'CONFIRMED':
    case 'PENDING':
      return 'bg-sky-100 text-sky-800';
    case 'CHECKED_IN':
      return 'bg-emerald-100 text-emerald-800';
    case 'CHECKED_OUT':
      return 'bg-aubergine-100 text-aubergine-800';
    case 'CANCELLED':
      return 'bg-rose-100 text-rose-800';
    case 'NO_SHOW':
      return 'bg-rose-200 text-rose-900';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}
