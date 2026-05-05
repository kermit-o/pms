export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-6 px-6 py-16">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Sprint 2 · Front Office
        </p>
        <h1 className="text-5xl font-semibold tracking-tight text-aubergine-700">
          Aubergine
        </h1>
        <p className="text-lg text-aubergine-700/80">
          AI-native PMS for boutique hotels.
        </p>
      </header>

      <section className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-aubergine-100">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-aubergine-500">
          Estado del scaffold
        </h2>
        <ul className="space-y-2 text-sm text-aubergine-900">
          <li>✓ Next.js 15 + React 19 + Tailwind</li>
          <li>· Login OIDC (Keycloak) — pendiente</li>
          <li>· Dashboard ocupación / KPIs — pendiente</li>
          <li>· Calendar Mews-style — pendiente</li>
          <li>· Reservation form (CRUD, walk-in, group) — pendiente</li>
          <li>· Cardex GDPR — pendiente</li>
          <li>· Folio (cargos, pagos, splits) — pendiente</li>
          <li>· Copilot sidebar — pendiente</li>
        </ul>
      </section>

      <footer className="text-xs text-aubergine-700/60">
        Plan completo en <code>docs/SPRINT-2-PLAN.md</code>.
      </footer>
    </main>
  );
}
