import Link from 'next/link';
import type { ListReservationsQuery } from '@/lib/api';

const STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'] as const;
const SOURCES = [
  'DIRECT',
  'WALK_IN',
  'PHONE',
  'EMAIL',
  'BOOKING_COM',
  'EXPEDIA',
  'OTHER_OTA',
  'CORPORATE',
  'AGENT',
] as const;

interface ChipPreset {
  label: string;
  filters: Partial<ListReservationsQuery>;
}

/**
 * Genera la lista de chips disponibles. Hoy fechas calculadas server-side.
 */
function buildChips(): ChipPreset[] {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const sevenAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  return [
    {
      label: 'Llegadas hoy',
      filters: { arrivalFrom: today, arrivalTo: today, status: 'PENDING,CONFIRMED' },
    },
    {
      label: 'Salidas hoy',
      filters: { departureFrom: today, departureTo: today, status: 'CHECKED_IN,CHECKED_OUT' },
    },
    { label: 'In-house', filters: { status: 'CHECKED_IN' } },
    { label: 'Pendientes', filters: { status: 'PENDING,CONFIRMED' } },
    { label: 'Garantía pendiente', filters: { guaranteeStatus: 'PENDING' } },
    { label: 'Sin habitación', filters: { unassigned: 'true', status: 'PENDING,CONFIRMED' } },
    { label: 'Walk-ins hoy', filters: { source: 'WALK_IN', arrivalFrom: today, arrivalTo: today } },
    { label: 'Cancelados 7d', filters: { status: 'CANCELLED', arrivalFrom: sevenAgo } },
    { label: 'Mañana', filters: { arrivalFrom: tomorrow, arrivalTo: tomorrow } },
  ];
}

function paramsToString(filters: Partial<ListReservationsQuery>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  return p.toString();
}

export function ReservationsFilters({
  basePath,
  current,
}: {
  basePath: string;
  current: Partial<ListReservationsQuery>;
}) {
  const chips = buildChips();

  return (
    <div className="space-y-3">
      {/* Smart search */}
      <form
        action={basePath}
        method="get"
        className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-aubergine-100"
      >
        <label className="flex-1 text-xs">
          <span className="block font-medium uppercase tracking-wide text-aubergine-500">
            Búsqueda
          </span>
          <input
            name="search"
            type="text"
            defaultValue={current.search ?? ''}
            placeholder="Nombre, apellido, código (BBM01-…), email, teléfono, grupo, agencia…"
            className="mt-1 w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-aubergine-700 px-4 py-2 text-sm font-medium text-white hover:bg-aubergine-800"
        >
          Buscar
        </button>
        {Object.values(current).some((v) => v) && (
          <Link
            href={basePath}
            className="rounded-lg bg-white px-4 py-2 text-sm text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-50"
          >
            Limpiar
          </Link>
        )}
      </form>

      {/* Quick filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => {
          const q = paramsToString(c.filters);
          const active = Object.entries(c.filters).every(
            ([k, v]) => (current as Record<string, unknown>)[k] === v,
          );
          return (
            <Link
              key={c.label}
              href={`${basePath}${q ? `?${q}` : ''}`}
              className={
                active
                  ? 'rounded-full bg-aubergine-700 px-3 py-1 text-xs font-medium text-white'
                  : 'rounded-full bg-white px-3 py-1 text-xs text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-50'
              }
            >
              {c.label}
            </Link>
          );
        })}
      </div>

      {/* Advanced filters */}
      <details className="rounded-2xl bg-white shadow-sm ring-1 ring-aubergine-100">
        <summary className="cursor-pointer px-4 py-2 text-xs font-semibold uppercase tracking-wide text-aubergine-500">
          Filtros avanzados ▾
        </summary>
        <form
          action={basePath}
          method="get"
          className="grid gap-3 border-t border-aubergine-100 p-4 sm:grid-cols-4"
        >
          {/* Conservar search libre si está */}
          {current.search && <input type="hidden" name="search" value={current.search} />}

          <fieldset className="space-y-2">
            <legend className="text-[11px] font-semibold uppercase tracking-wide text-aubergine-500">
              Estancia
            </legend>
            <DateRange
              label="Arrival"
              fromName="arrivalFrom"
              toName="arrivalTo"
              fromValue={current.arrivalFrom}
              toValue={current.arrivalTo}
            />
            <DateRange
              label="Departure"
              fromName="departureFrom"
              toName="departureTo"
              fromValue={current.departureFrom}
              toValue={current.departureTo}
            />
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-[11px] font-semibold uppercase tracking-wide text-aubergine-500">
              Estado
            </legend>
            <MultiSelect
              name="status"
              options={STATUSES}
              value={(current.status ?? '').split(',').filter(Boolean)}
            />
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-[11px] font-semibold uppercase tracking-wide text-aubergine-500">
              Source
            </legend>
            <MultiSelect
              name="source"
              options={SOURCES}
              value={(current.source ?? '').split(',').filter(Boolean)}
            />
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-[11px] font-semibold uppercase tracking-wide text-aubergine-500">
              Garantía
            </legend>
            <select
              name="guaranteeStatus"
              defaultValue={current.guaranteeStatus ?? ''}
              className="w-full rounded-lg border border-aubergine-100 bg-white px-2 py-1 text-xs"
            >
              <option value="">— cualquiera —</option>
              <option value="PENDING">PENDING</option>
              <option value="SECURED">SECURED</option>
              <option value="EXPIRED">EXPIRED</option>
              <option value="FAILED">FAILED</option>
              <option value="RELEASED">RELEASED</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-aubergine-700">
              <input
                type="checkbox"
                name="unassigned"
                value="true"
                defaultChecked={current.unassigned === 'true'}
              />
              Sin habitación asignada
            </label>
          </fieldset>

          <div className="sm:col-span-4 flex justify-end gap-2">
            <Link
              href={basePath}
              className="rounded-lg bg-white px-4 py-1.5 text-xs text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-50"
            >
              Limpiar
            </Link>
            <button
              type="submit"
              className="rounded-lg bg-aubergine-700 px-4 py-1.5 text-xs font-medium text-white"
            >
              Aplicar filtros
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}

function DateRange({
  label,
  fromName,
  toName,
  fromValue,
  toValue,
}: {
  label: string;
  fromName: string;
  toName: string;
  fromValue?: string;
  toValue?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-1">
      <input
        type="date"
        name={fromName}
        defaultValue={fromValue ?? ''}
        title={`${label} desde`}
        className="rounded-lg border border-aubergine-100 bg-white px-2 py-1 text-xs"
      />
      <input
        type="date"
        name={toName}
        defaultValue={toValue ?? ''}
        title={`${label} hasta`}
        className="rounded-lg border border-aubergine-100 bg-white px-2 py-1 text-xs"
      />
    </div>
  );
}

function MultiSelect({
  name,
  options,
  value,
}: {
  name: string;
  options: readonly string[];
  value: string[];
}) {
  // Render como checkboxes que un script junta como CSV. Sin JS de cliente,
  // un submit con varios checkbox del mismo name produce varios valores;
  // los serializamos a CSV en el server reading params.getAll(name).join(',')
  // Pero como queremos que sigan funcionando con el query habitual,
  // optamos por un <select multiple>.
  return (
    <select
      name={name}
      multiple
      defaultValue={value}
      size={Math.min(options.length, 6)}
      className="w-full rounded-lg border border-aubergine-100 bg-white px-2 py-1 text-xs"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o.toLowerCase().replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  );
}
