import Link from 'next/link';
import type { ReservationRichListItem } from '@/lib/api';

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-sky-100 text-sky-800',
  CHECKED_IN: 'bg-emerald-100 text-emerald-800',
  CHECKED_OUT: 'bg-aubergine-100 text-aubergine-800',
  CANCELLED: 'bg-rose-100 text-rose-800',
  NO_SHOW: 'bg-rose-200 text-rose-900',
};

export function ReservationsTable({
  items,
  emptyMessage = 'Sin resultados.',
}: {
  items: ReservationRichListItem[];
  emptyMessage?: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-10 text-center text-sm text-aubergine-700/60 ring-1 ring-aubergine-100">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-aubergine-100">
      <table className="min-w-full text-xs">
        <thead className="bg-aubergine-50 text-left text-[10px] uppercase tracking-wide text-aubergine-500">
          <tr>
            <Th>Código</Th>
            <Th>Hab.</Th>
            <Th>Tipo</Th>
            <Th>Huésped</Th>
            <Th>Llegada</Th>
            <Th>Salida</Th>
            <Th className="text-right">N</Th>
            <Th className="text-right">PAX</Th>
            <Th className="text-right">Rate/n</Th>
            <Th className="text-right">Balance</Th>
            <Th>Rate</Th>
            <Th>Agencia / Empresa</Th>
            <Th>Group</Th>
            <Th>Estado</Th>
            <Th>Garantía</Th>
            <Th>Source</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-aubergine-100/70">
          {items.map((r) => {
            const nights = Math.max(
              1,
              Math.round(
                (new Date(r.departureDate).getTime() - new Date(r.arrivalDate).getTime()) /
                  86_400_000,
              ),
            );
            const total = Number(r.totalAmount);
            const ratePerNight = Number.isFinite(total) && nights > 0 ? total / nights : 0;
            const guest = r.primaryGuest
              ? `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`.trim()
              : '—';
            return (
              <tr key={r.id} className="hover:bg-aubergine-50/30">
                <Td>
                  <Link
                    href={`/reservations/${r.id}`}
                    className="font-mono text-aubergine-700 hover:underline"
                  >
                    {r.code}
                  </Link>
                </Td>
                <Td className="font-mono">
                  {r.roomNumber ? (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">
                      {r.roomNumber}
                      {r.roomFloor && <span className="ml-1 text-emerald-700/60">P{r.roomFloor}</span>}
                    </span>
                  ) : (
                    <span className="text-aubergine-700/40">—</span>
                  )}
                </Td>
                <Td className="text-aubergine-700/70">{r.roomTypeCode ?? '—'}</Td>
                <Td>{guest}</Td>
                <Td>{r.arrivalDate}</Td>
                <Td>{r.departureDate}</Td>
                <Td className="text-right">{nights}</Td>
                <Td className="text-right">
                  {r.adults}
                  {r.children > 0 && <span className="text-aubergine-700/50">+{r.children}</span>}
                </Td>
                <Td className="text-right">
                  {ratePerNight ? `${ratePerNight.toFixed(0)} ${r.currency}` : '—'}
                </Td>
                <Td className="text-right">
                  {r.folioBalance ? `${r.folioBalance} ${r.currency}` : '—'}
                </Td>
                <Td className="text-aubergine-700/70">{r.ratePlanCode ?? '—'}</Td>
                <Td className="text-aubergine-700/70">
                  {r.organizerName ?? <span className="text-aubergine-700/40">—</span>}
                </Td>
                <Td>
                  {r.groupId ? (
                    <Link
                      href={`/reservations/groups/${r.groupId}`}
                      className="rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-800 hover:bg-indigo-200"
                    >
                      {r.groupCode ?? 'group'}
                    </Link>
                  ) : (
                    <span className="text-aubergine-700/40">—</span>
                  )}
                </Td>
                <Td>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      STATUS_STYLES[r.status] ?? 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {r.status.toLowerCase().replace('_', ' ')}
                  </span>
                </Td>
                <Td>
                  <span
                    className={
                      r.guaranteeStatus === 'SECURED'
                        ? 'rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800'
                        : r.guaranteeStatus === 'PENDING'
                          ? 'rounded bg-amber-100 px-1.5 py-0.5 text-amber-800'
                          : 'rounded bg-rose-100 px-1.5 py-0.5 text-rose-800'
                    }
                  >
                    {r.guaranteeStatus.toLowerCase()}
                  </span>
                </Td>
                <Td className="text-aubergine-700/70">
                  {r.source.toLowerCase().replace(/_/g, ' ')}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-semibold ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
