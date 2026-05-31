import type { CopilotAvailabilityWidget } from '@/lib/api';

/**
 * Sprint 13 W4 — Pinta el resultado de search_availability_by_type
 * como una lista de tarjetas. Los precios y disponibilidad vienen del
 * tool, no del LLM — imposible alucinar aquí.
 *
 * Cada fila tiene un botón "Reservar" que abre /reservations/new con
 * los parámetros prerrellenados (fechas + roomTypeId).
 */
export function CopilotAvailabilityWidget({ widget }: { widget: CopilotAvailabilityWidget }) {
  const { arrival, departure, nights, rows } = widget.data;
  return (
    <section className="mt-2 space-y-2 rounded-xl bg-white p-3 ring-1 ring-aubergine-200">
      <header className="flex items-baseline justify-between text-[11px] uppercase tracking-wide text-aubergine-500">
        <span>Disponibilidad · datos en vivo</span>
        <span className="font-mono normal-case">
          {arrival} → {departure} · {nights} {nights === 1 ? 'noche' : 'noches'}
        </span>
      </header>
      {rows.length === 0 && (
        <p className="text-xs text-aubergine-700/60">Sin tipos disponibles en el rango.</p>
      )}
      <ul className="space-y-1.5">
        {rows.map((row) => {
          const soldOut = row.available === 0;
          const bookHref = `/reservations/new?step=3&arrival=${arrival}&departure=${departure}&adults=2&children=0&roomTypeId=${row.roomTypeId}`;
          return (
            <li
              key={row.roomTypeId}
              className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs ring-1 ${
                soldOut
                  ? 'bg-aubergine-50/40 text-aubergine-700/50 ring-aubergine-100'
                  : 'bg-aubergine-50 text-aubergine-900 ring-aubergine-100'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5">
                  <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-aubergine-700 ring-1 ring-aubergine-100">
                    {row.code}
                  </span>
                  <span className="truncate font-medium">{row.name}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                      soldOut ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {row.available}/{row.totalRooms}
                  </span>
                </p>
                {row.description && (
                  <p className="mt-0.5 truncate text-[11px] text-aubergine-700/60">
                    {row.description}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2 text-right">
                <div>
                  <p className="font-semibold text-aubergine-700">
                    {Number(row.totalForStay).toFixed(0)} {row.currency}
                  </p>
                  <p className="text-[10px] text-aubergine-700/60">{row.pricePerNight}/noche</p>
                </div>
                {!soldOut && (
                  <a
                    href={bookHref}
                    className="rounded-md bg-aubergine-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-aubergine-800"
                  >
                    Reservar →
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
