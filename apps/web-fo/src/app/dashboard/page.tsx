import Link from 'next/link';
import { auth, signOut } from '@/auth';
import { fetchDashboardKpis } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await auth();
  const kpis = await fetchDashboardKpis(session?.accessToken);

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
            Aubergine · Front Office
          </p>
          <h1 className="text-3xl font-semibold text-aubergine-700">Dashboard</h1>
          <p className="text-sm text-aubergine-700/70">
            Hola {session?.user?.name ?? session?.user?.email ?? 'recepción'}.
          </p>
        </div>
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/login' });
          }}
        >
          <button
            type="submit"
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-aubergine-700 ring-1 ring-aubergine-100 transition hover:bg-aubergine-50"
          >
            Cerrar sesión
          </button>
        </form>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Llegadas hoy" value={kpis.arrivalsToday} />
        <KpiCard label="Salidas hoy" value={kpis.departuresToday} />
        <KpiCard label="In-house" value={kpis.inHouse} />
        <KpiCard label="Ocupación" value={`${Math.round(kpis.occupancyPct * 100)}%`} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Tile href="/calendar" label="Calendar" sub="Disponibilidad por habitación" />
        <Tile href="/reservations" label="Reservas" sub="Listar, crear, cancelar" />
        <Tile href="/guests" label="Cardex" sub="Huéspedes + GDPR" />
        <Tile href="/rooms" label="Habitaciones" sub="Estado + OOO" />
        <Tile href="/business-day" label="Cierre de día" sub="Lock operacional" />
        <Tile href="/compliance/ses" label="SES.HOSPEDAJES" sub="Partes Guardia Civil" />
        <Tile href="/reservations/new?walkIn=1" label="Walk-in" sub="Check-in inmediato" />
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-aubergine-500">
          Próximas semanas
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-aubergine-900">
          <li>S2-W2 · Calendar Mews-style + reservation form</li>
          <li>S2-W3 · Folio (cargos / pagos / splits)</li>
          <li>S2-W4 · Cardex GDPR</li>
          <li>S2-W5 · Rooms availability + close-day</li>
          <li>S2-W6 · SES.HOSPEDAJES sender</li>
          <li>S2-W7 · Copilot sidebar</li>
        </ul>
      </section>
    </main>
  );
}

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100">
      <p className="text-xs font-medium uppercase tracking-wide text-aubergine-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-aubergine-700">{value}</p>
    </article>
  );
}

function Tile({ href, label, sub }: { href: string; label: string; sub: string }) {
  return (
    <Link
      href={href}
      className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100 transition hover:bg-aubergine-50"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-aubergine-500">{label}</p>
      <p className="mt-1 text-base font-medium text-aubergine-700">{sub}</p>
    </Link>
  );
}
