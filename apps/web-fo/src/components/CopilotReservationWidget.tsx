import type { CopilotReservationWidget } from '@/lib/api';

/**
 * Sprint 13 — Pinta el resultado de get_reservation como tarjeta
 * resumen: header con código + estado, datos clave (huésped, fechas,
 * habitación) y mini-resumen del folio. Datos exactos del tool.
 */
export function CopilotReservationWidget({ widget }: { widget: CopilotReservationWidget }) {
  const {
    reservationId,
    reservationCode,
    status,
    arrival,
    departure,
    nights,
    adults,
    children,
    totalAmount,
    currency,
    roomTypeCode,
    roomTypeName,
    roomNumber,
    guest,
    guaranteeStatus,
    cardBrand,
    cardLast4,
    folio,
  } = widget.data;
  const pax = adults + children;
  const balanceNum = folio ? Number(folio.balance) : 0;

  return (
    <section className="mt-2 space-y-2 rounded-xl bg-white p-3 ring-1 ring-aubergine-200">
      <header className="flex items-baseline justify-between gap-2 text-[11px] uppercase tracking-wide text-aubergine-500">
        <span className="flex items-center gap-1.5">
          Reserva · datos en vivo
          <StatusChip status={status} />
        </span>
        <span className="font-mono normal-case">{reservationCode}</span>
      </header>

      {guest && (
        <div className="rounded-lg bg-aubergine-50 px-3 py-2">
          <p className="font-semibold text-aubergine-700">
            {guest.firstName} {guest.lastName}
          </p>
          <p className="mt-0.5 text-[11px] text-aubergine-700/70">
            {guest.email && <span className="mr-2">{guest.email}</span>}
            {guest.phone && <span className="font-mono">{guest.phone}</span>}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5 text-xs">
        <Field label="Llegada" value={arrival} mono />
        <Field label="Salida" value={departure} mono />
        <Field
          label="Estancia"
          value={`${nights} ${nights === 1 ? 'noche' : 'noches'} · ${pax} pax`}
        />
        <Field
          label="Tipo"
          value={
            roomNumber
              ? `${roomTypeCode} · hab. ${roomNumber}`
              : `${roomTypeCode} · sin asignar`
          }
          title={roomTypeName}
        />
        <Field
          label="Total"
          value={`${Number(totalAmount).toFixed(2)} ${currency}`}
          highlight
        />
        <Field
          label="Garantía"
          value={
            cardLast4
              ? `${guaranteeStatus} · ${cardBrand ?? ''} ****${cardLast4}`.trim()
              : guaranteeStatus
          }
        />
      </div>

      {folio && (
        <div className="flex items-baseline justify-between rounded-lg bg-amber-50/40 px-2.5 py-1.5 ring-1 ring-amber-100">
          <span className="text-[10px] uppercase tracking-wide text-amber-900/70">
            Folio · saldo
          </span>
          <span
            className={`font-semibold ${
              balanceNum > 0
                ? 'text-amber-700'
                : balanceNum < 0
                  ? 'text-emerald-700'
                  : 'text-aubergine-700/60'
            }`}
          >
            {balanceNum.toFixed(2)} {folio.currency}
          </span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <a
          href={`/reservations/${reservationId}`}
          className="rounded-md bg-aubergine-700 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-aubergine-800"
        >
          Abrir ficha →
        </a>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  mono,
  highlight,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  title?: string;
}) {
  return (
    <div
      className={`rounded-md px-2 py-1 ring-1 ring-aubergine-100 ${
        highlight ? 'bg-aubergine-50' : 'bg-white'
      }`}
      title={title}
    >
      <p className="text-[9px] uppercase tracking-wide text-aubergine-500">{label}</p>
      <p
        className={`mt-0.5 ${mono ? 'font-mono' : ''} ${
          highlight ? 'font-semibold text-aubergine-700' : 'text-aubergine-900'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-800',
  CONFIRMED: 'bg-aubergine-50 text-aubergine-700',
  CHECKED_IN: 'bg-emerald-50 text-emerald-700',
  CHECKED_OUT: 'bg-slate-100 text-slate-700',
  CANCELLED: 'bg-rose-50 text-rose-700',
  NO_SHOW: 'bg-rose-50 text-rose-700',
};

function StatusChip({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? 'bg-aubergine-50 text-aubergine-700';
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold normal-case ${cls}`}
    >
      {status}
    </span>
  );
}
