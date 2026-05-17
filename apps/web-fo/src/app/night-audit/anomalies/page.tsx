import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  ApiError,
  listNightAuditAnomalies,
  reviewNightAuditAnomaly,
  type NightAuditAnomaly,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: {
    propertyId?: string;
    businessDate?: string;
    severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    reviewed?: 'yes' | 'no';
  };
}

export default async function AnomaliesPage({ searchParams }: PageProps) {
  const session = await auth();
  const propertyId = searchParams.propertyId;
  const businessDate = searchParams.businessDate;
  const severity = searchParams.severity;
  const reviewed = searchParams.reviewed ?? 'no';

  let rows: NightAuditAnomaly[] = [];
  let error: string | null = null;

  try {
    rows = await listNightAuditAnomalies(session?.accessToken, {
      propertyId,
      businessDate,
      severity,
      reviewed,
    });
  } catch (err) {
    error = err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
  }

  async function markReviewed(formData: FormData) {
    'use server';
    const session = await auth();
    const id = formData.get('id')?.toString();
    const notes = formData.get('notes')?.toString();
    if (!id) throw new Error('Falta id de anomalía');
    await reviewNightAuditAnomaly(session?.accessToken, id, notes || undefined);
    revalidatePath('/night-audit/anomalies');
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-aubergine-700">Anomalías del Night Audit</h1>
        <p className="text-sm text-aubergine-700/60">
          Señales detectadas durante el cierre. Nada se auto-corrige — el supervisor decide.
        </p>
      </header>

      <form className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100">
        <label className="text-xs text-aubergine-700">
          Property
          <input
            type="text"
            name="propertyId"
            defaultValue={propertyId ?? ''}
            placeholder="UUID propiedad"
            className="block w-72 rounded-lg ring-1 ring-aubergine-100 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-aubergine-700">
          Fecha negocio
          <input
            type="date"
            name="businessDate"
            defaultValue={businessDate ?? ''}
            className="block rounded-lg ring-1 ring-aubergine-100 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-aubergine-700">
          Severidad
          <select
            name="severity"
            defaultValue={severity ?? ''}
            className="block rounded-lg ring-1 ring-aubergine-100 px-2 py-1 text-sm"
          >
            <option value="">Todas</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </label>
        <label className="text-xs text-aubergine-700">
          Estado
          <select
            name="reviewed"
            defaultValue={reviewed}
            className="block rounded-lg ring-1 ring-aubergine-100 px-2 py-1 text-sm"
          >
            <option value="no">Sin revisar</option>
            <option value="yes">Revisadas</option>
            <option value="">Todas</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg bg-aubergine-700 px-3 py-1.5 text-sm font-medium text-white"
        >
          Filtrar
        </button>
      </form>

      {error && (
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">
          {error}
        </div>
      )}

      {!error && rows.length === 0 && (
        <p className="rounded-lg bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-800 ring-1 ring-emerald-200">
          Sin anomalías con esos filtros.
        </p>
      )}

      <ul className="space-y-3">
        {rows.map((a) => (
          <li
            key={a.id}
            className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100"
          >
            <div className="flex flex-wrap items-center gap-3">
              <SeverityBadge severity={a.severity} />
              <KindBadge kind={a.kind} />
              <span className="text-sm text-aubergine-700/70">{a.businessDate}</span>
              {a.reviewedAt && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 ring-1 ring-emerald-200">
                  Revisada {new Date(a.reviewedAt).toLocaleString('es-ES')}
                </span>
              )}
            </div>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-aubergine-50 p-3 text-xs text-aubergine-800">
              {JSON.stringify(a.details, null, 2)}
            </pre>
            {!a.reviewedAt && (
              <form action={markReviewed} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={a.id} />
                <label className="flex-1 text-xs text-aubergine-700">
                  Notas (opcional)
                  <input
                    name="notes"
                    type="text"
                    placeholder="Qué se hizo / por qué se ignora"
                    className="block w-full rounded-lg ring-1 ring-aubergine-100 px-2 py-1 text-sm"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
                >
                  Marcar revisada
                </button>
              </form>
            )}
            {a.reviewNotes && (
              <p className="mt-2 text-xs text-aubergine-700/70 italic">"{a.reviewNotes}"</p>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}

function SeverityBadge({ severity }: { severity: NightAuditAnomaly['severity'] }) {
  const styles: Record<typeof severity, string> = {
    CRITICAL: 'bg-rose-100 text-rose-800 ring-rose-200',
    HIGH: 'bg-amber-100 text-amber-800 ring-amber-200',
    MEDIUM: 'bg-yellow-100 text-yellow-800 ring-yellow-200',
    LOW: 'bg-aubergine-100 text-aubergine-800 ring-aubergine-200',
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${styles[severity]}`}>
      {severity.toLowerCase()}
    </span>
  );
}

function KindBadge({ kind }: { kind: NightAuditAnomaly['kind'] }) {
  const labels: Record<typeof kind, string> = {
    DUPLICATE_CHARGE: 'Cargo duplicado',
    CASH_DRAWER_VARIANCE: 'Variación de caja',
    DEEP_DISCOUNT: 'Descuento profundo',
    CANCELLATION_SPREE: 'Cancelaciones múltiples',
    RATE_OVERRIDE: 'Override de tarifa',
  };
  return (
    <span className="rounded-full bg-white px-2.5 py-0.5 text-xs text-aubergine-700 ring-1 ring-aubergine-200">
      {labels[kind]}
    </span>
  );
}
