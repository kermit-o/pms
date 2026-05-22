import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import {
  ApiError,
  getMySubscription,
  openBillingPortal,
  startMySubscription,
  type TenantSubscription,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ started?: string; error?: string }>;
}

/**
 * Sprint 14 W1 — Página admin de facturación del SaaS (NO huésped).
 * Muestra estado de la suscripción, CTA "Empezar trial" si no existe,
 * y botón "Gestionar (Stripe Portal)" si ya hay sub. Sólo
 * `tenant_admin`.
 */
export default async function BillingAdminPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const session = await auth();
  if (!session?.accessToken) redirect('/admin/billing');
  if (!session.roles?.includes('tenant_admin')) return notFound();

  let sub: TenantSubscription;
  try {
    sub = await getMySubscription(session.accessToken);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return notFound();
    throw err;
  }

  async function startAction() {
    'use server';
    const s = await auth();
    if (!s?.accessToken) redirect('/admin/billing');
    try {
      await startMySubscription(s.accessToken);
      redirect('/admin/billing?started=1');
    } catch (err) {
      if (err instanceof ApiError) {
        redirect(`/admin/billing?error=${encodeURIComponent(err.body.slice(0, 100))}`);
      }
      throw err;
    }
  }

  async function portalAction() {
    'use server';
    const s = await auth();
    if (!s?.accessToken) redirect('/admin/billing');
    const returnUrl =
      (process.env.NEXTAUTH_URL ?? 'http://localhost:3001') + '/admin/billing';
    try {
      const { url } = await openBillingPortal(s.accessToken, returnUrl);
      redirect(url);
    } catch (err) {
      if (err instanceof ApiError) {
        redirect(`/admin/billing?error=${encodeURIComponent(err.body.slice(0, 100))}`);
      }
      throw err;
    }
  }

  const statusInfo = describeStatus(sub.status);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Admin
        </p>
        <h1 className="text-3xl font-semibold text-aubergine-700">Facturación SaaS</h1>
        <p className="mt-1 text-sm text-aubergine-700/70">
          Tu suscripción a Aubergine PMS. La facturación del huésped (cobros con
          Stripe) es independiente — esto sólo afecta lo que pagas tú por usar la
          plataforma.
        </p>
      </header>

      {sp.started === '1' && (
        <Banner kind="success">
          Suscripción iniciada. Tu trial empieza ahora.
        </Banner>
      )}
      {sp.error && <Banner kind="error">{sp.error}</Banner>}

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-aubergine-700">{sub.tenantName}</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusInfo.cls}`}
          >
            {statusInfo.label}
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Estado" value={sub.status ?? 'sin suscripción'} />
          <Field
            label="Fin del trial"
            value={sub.trialEndsAt ? formatDate(sub.trialEndsAt) : '—'}
          />
          <Field
            label="Próxima renovación"
            value={sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : '—'}
          />
        </dl>

        <div className="mt-6 flex flex-wrap gap-2">
          {!sub.hasSubscription ? (
            <form action={startAction}>
              <button
                type="submit"
                className="rounded-lg bg-aubergine-700 px-4 py-2 text-sm font-semibold text-white hover:bg-aubergine-800"
              >
                Empezar trial
              </button>
            </form>
          ) : (
            <form action={portalAction}>
              <button
                type="submit"
                className="rounded-lg bg-aubergine-700 px-4 py-2 text-sm font-semibold text-white hover:bg-aubergine-800"
              >
                Gestionar suscripción (Stripe Portal) →
              </button>
            </form>
          )}
        </div>
      </section>

      {statusInfo.warn && (
        <Banner kind="error">{statusInfo.warn}</Banner>
      )}

      <p className="text-[11px] text-aubergine-700/40">
        El portal de Stripe te permite cambiar tu tarjeta, ver facturas y
        cancelar tu suscripción en cualquier momento.
      </p>
    </main>
  );
}

function describeStatus(status: string | null): {
  label: string;
  cls: string;
  warn?: string;
} {
  switch (status) {
    case 'trialing':
      return { label: 'TRIAL', cls: 'bg-aubergine-50 text-aubergine-700' };
    case 'active':
      return { label: 'ACTIVA', cls: 'bg-emerald-50 text-emerald-700' };
    case 'past_due':
      return {
        label: 'PAGO PENDIENTE',
        cls: 'bg-amber-100 text-amber-900',
        warn: 'Tu último pago falló. Actualiza tu tarjeta en el portal de Stripe antes de que se suspenda el servicio.',
      };
    case 'paused':
      return {
        label: 'PAUSADA',
        cls: 'bg-rose-100 text-rose-900',
        warn: 'Tu suscripción está pausada porque el trial terminó sin método de pago. Añade tarjeta para reanudar.',
      };
    case 'canceled':
      return {
        label: 'CANCELADA',
        cls: 'bg-rose-100 text-rose-900',
        warn: 'Tu suscripción está cancelada. Reactívala desde el portal de Stripe.',
      };
    case 'unpaid':
      return {
        label: 'IMPAGADA',
        cls: 'bg-rose-100 text-rose-900',
        warn: 'Tienes facturas impagadas. Resuélvelo en el portal de Stripe.',
      };
    case 'incomplete':
    case 'incomplete_expired':
      return {
        label: status.toUpperCase().replace('_', ' '),
        cls: 'bg-amber-100 text-amber-900',
      };
    default:
      return { label: 'SIN SUSCRIPCIÓN', cls: 'bg-aubergine-50 text-aubergine-700/60' };
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-aubergine-50/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-aubergine-500">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-aubergine-900">{value}</p>
    </div>
  );
}

function Banner({ kind, children }: { kind: 'success' | 'error'; children: React.ReactNode }) {
  const cls =
    kind === 'success'
      ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
      : 'bg-rose-50 text-rose-900 ring-rose-200';
  return <div className={`rounded-xl px-4 py-3 text-sm ring-1 ${cls}`}>{children}</div>;
}
