import type { CopilotFolioWidget } from '@/lib/api';

/**
 * Sprint 13 — Pinta el resultado de get_folio como una tarjeta con
 * cabecera (código de reserva, estado, balance) y lista de entries
 * (cargos y pagos). Datos exactos del tool — el LLM no puede alucinar
 * un saldo aquí.
 */
export function CopilotFolioWidget({ widget }: { widget: CopilotFolioWidget }) {
  const { folioId, reservationCode, reservationId, status, balance, currency, entries } =
    widget.data;
  const balanceNum = Number(balance);
  const isOpen = status === 'OPEN';
  return (
    <section className="mt-2 space-y-2 rounded-xl bg-white p-3 ring-1 ring-aubergine-200">
      <header className="flex items-baseline justify-between gap-2 text-[11px] uppercase tracking-wide text-aubergine-500">
        <span className="flex items-center gap-1.5">
          Folio · datos en vivo
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] normal-case ${
              isOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-aubergine-50 text-aubergine-700/70'
            }`}
          >
            {status}
          </span>
        </span>
        <span className="font-mono normal-case">{reservationCode}</span>
      </header>

      <div className="flex items-baseline justify-between rounded-lg bg-aubergine-50 px-3 py-2">
        <span className="text-[11px] uppercase tracking-wide text-aubergine-500">
          Saldo pendiente
        </span>
        <span
          className={`text-lg font-semibold ${
            balanceNum > 0
              ? 'text-amber-700'
              : balanceNum < 0
                ? 'text-emerald-700'
                : 'text-aubergine-700'
          }`}
        >
          {balanceNum.toFixed(2)} {currency}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="px-1 text-xs text-aubergine-700/60">Sin movimientos en el folio.</p>
      ) : (
        <ul className="space-y-1">
          {entries.slice(0, 6).map((e) => {
            const amount = Number(e.amount);
            const isCredit = amount < 0;
            return (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs hover:bg-aubergine-50/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5">
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase ring-1 ${
                        isCredit
                          ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
                          : 'bg-aubergine-50 text-aubergine-700 ring-aubergine-100'
                      }`}
                    >
                      {e.type}
                    </span>
                    <span className="truncate text-aubergine-900">{e.description}</span>
                  </p>
                  <p className="text-[10px] text-aubergine-700/50">
                    {new Date(e.postedAt).toLocaleString('es-ES', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-semibold ${
                    isCredit ? 'text-emerald-700' : 'text-aubergine-700'
                  }`}
                >
                  {amount.toFixed(2)} {e.currency}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {entries.length > 6 && (
        <p className="px-1 text-[10px] text-aubergine-700/50">
          Mostrando 6 de {entries.length} movimientos.
        </p>
      )}

      <div className="flex justify-end">
        <a
          href={`/reservations/${reservationId}`}
          className="rounded-md bg-aubergine-700 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-aubergine-800"
        >
          Abrir ficha →
        </a>
      </div>

      <p className="text-[9px] text-aubergine-700/40">folio {folioId.slice(0, 8)}</p>
    </section>
  );
}
