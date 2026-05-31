import type { CopilotMovementsWidget } from '@/lib/api';

/**
 * Sprint 13 — Pinta el resultado de list_movements (arrivals o
 * departures) como lista de reservas del día con huésped, habitación,
 * status de garantía y saldo de folio. Datos exactos del tool.
 */
export function CopilotMovementsWidget({ widget }: { widget: CopilotMovementsWidget }) {
  const { direction, businessDate, rows } = widget.data;
  const isArrival = direction === 'arrival';
  return (
    <section className="mt-2 space-y-2 rounded-xl bg-white p-3 ring-1 ring-aubergine-200">
      <header className="flex items-baseline justify-between gap-2 text-[11px] uppercase tracking-wide text-aubergine-500">
        <span className="flex items-center gap-1.5">
          {isArrival ? 'Llegadas' : 'Salidas'} · datos en vivo
          <span className="rounded-full bg-aubergine-50 px-1.5 py-0.5 text-[10px] normal-case font-mono text-aubergine-700">
            {rows.length}
          </span>
        </span>
        <span className="font-mono normal-case">{businessDate}</span>
      </header>

      {rows.length === 0 ? (
        <p className="px-1 text-xs text-aubergine-700/60">
          Sin {isArrival ? 'llegadas previstas' : 'salidas previstas'} para esta fecha.
        </p>
      ) : (
        <ul className="space-y-1">
          {rows.slice(0, 12).map((r) => {
            const balance = r.folioBalance ? Number(r.folioBalance) : 0;
            const balanceWarn = !isArrival && balance > 0;
            const guaranteeWarn = isArrival && r.guaranteeStatus !== 'SECURED';
            return (
              <li
                key={r.reservationId}
                className="flex items-center justify-between gap-2 rounded-md bg-aubergine-50 px-2 py-1 text-xs ring-1 ring-aubergine-100"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5">
                    <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-aubergine-700 ring-1 ring-aubergine-100">
                      {r.roomNumber ? `hab ${r.roomNumber}` : 'sin hab.'}
                    </span>
                    <span className="truncate font-medium text-aubergine-900">
                      {r.guestLastName ?? '?'}, {r.guestFirstName ?? '?'}
                    </span>
                    <span className="font-mono text-[10px] text-aubergine-700/60">
                      {r.reservationCode}
                    </span>
                  </p>
                  <p className="text-[10px] text-aubergine-700/60">
                    {r.roomTypeCode ?? '?'} · {r.adults + r.children} pax · {r.totalAmount}{' '}
                    {r.currency}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-right">
                  {guaranteeWarn && (
                    <span
                      className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-900"
                      title="Garantía pendiente"
                    >
                      GAR
                    </span>
                  )}
                  {balanceWarn && (
                    <span
                      className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-semibold text-rose-900"
                      title="Saldo pendiente"
                    >
                      {balance.toFixed(0)} {r.currency}
                    </span>
                  )}
                  <a
                    href={`/reservations/${r.reservationId}`}
                    className="rounded bg-aubergine-700 px-1.5 py-0.5 text-[9px] font-semibold text-white hover:bg-aubergine-800"
                  >
                    Ver
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > 12 && (
        <p className="px-1 text-[10px] text-aubergine-700/50">
          Mostrando 12 de {rows.length}. Ve la lista completa en{' '}
          <a href={isArrival ? '/arrivals' : '/departures'} className="underline">
            {isArrival ? 'Llegadas' : 'Salidas'}
          </a>
          .
        </p>
      )}
    </section>
  );
}
