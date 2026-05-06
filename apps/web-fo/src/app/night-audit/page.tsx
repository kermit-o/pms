import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  ApiError,
  getNightAuditState,
  listNightAuditRuns,
  resumeNightAuditRun,
  runNightAudit,
  type NightAuditRunSummary,
  type NightAuditState,
  type NightAuditStep,
  type NightAuditStepStatus,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { propertyId?: string; businessDate?: string };
}

export default async function NightAuditPage({ searchParams }: PageProps) {
  const session = await auth();
  const propertyId = searchParams.propertyId;
  const businessDate = searchParams.businessDate ?? new Date().toISOString().slice(0, 10);

  let state: NightAuditState | null = null;
  let history: NightAuditRunSummary[] = [];
  let error: string | null = null;

  if (propertyId) {
    try {
      state = await getNightAuditState(session?.accessToken, propertyId, businessDate);
      history = await listNightAuditRuns(session?.accessToken, { propertyId });
    } catch (err) {
      error = err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
    }
  }

  async function runAction(formData: FormData) {
    'use server';
    const session = await auth();
    const propertyId = formData.get('propertyId')?.toString();
    const businessDate = formData.get('businessDate')?.toString();
    if (!propertyId || !businessDate) throw new Error('Faltan campos');
    await runNightAudit(session?.accessToken, propertyId, businessDate);
    revalidatePath(`/night-audit?propertyId=${propertyId}&businessDate=${businessDate}`);
  }

  async function resumeAction(formData: FormData) {
    'use server';
    const session = await auth();
    const runId = formData.get('runId')?.toString();
    const propertyId = formData.get('propertyId')?.toString();
    const businessDate = formData.get('businessDate')?.toString();
    if (!runId) throw new Error('Faltan campos');
    await resumeNightAuditRun(session?.accessToken, runId);
    revalidatePath(
      `/night-audit?propertyId=${propertyId ?? ''}&businessDate=${businessDate ?? ''}`,
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Operación
        </p>
        <h1 className="text-3xl font-semibold text-aubergine-700">Night Audit</h1>
        <p className="text-sm text-aubergine-700/70">
          Cierre nocturno orquestado e idempotente. Sprint 3 W1 ejecuta{' '}
          <code className="rounded bg-aubergine-50 px-1 py-0.5">POST_ROOM_CHARGES</code> y{' '}
          <code className="rounded bg-aubergine-50 px-1 py-0.5">CLOSE_DAY</code>; el resto de pasos
          están como stubs hasta W2-W4.
        </p>
      </header>

      <form
        action="/night-audit"
        method="get"
        className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-aubergine-100"
      >
        <label className="text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Property ID
          <input
            name="propertyId"
            type="text"
            defaultValue={propertyId ?? ''}
            placeholder="UUID"
            className="mt-1 block w-72 rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
          />
        </label>
        <label className="text-xs font-medium uppercase tracking-wide text-aubergine-500">
          Business date
          <input
            name="businessDate"
            type="date"
            defaultValue={businessDate}
            className="mt-1 block rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-aubergine-600 px-3 py-2 text-sm font-medium text-white hover:bg-aubergine-700"
        >
          Consultar
        </button>
      </form>

      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      )}

      {state && propertyId && (
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-aubergine-500">
            {state.businessDate}
          </h2>
          {state.run ? (
            <RunPanel
              run={state.run}
              propertyId={propertyId}
              businessDate={state.businessDate}
              resumeAction={resumeAction}
            />
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-aubergine-700/70">Día sin cierre todavía. Lanzar ahora:</p>
              <form action={runAction}>
                <input type="hidden" name="propertyId" value={propertyId} />
                <input type="hidden" name="businessDate" value={state.businessDate} />
                <button
                  type="submit"
                  className="rounded-lg bg-aubergine-700 px-4 py-2 text-sm font-medium text-white hover:bg-aubergine-900"
                >
                  Lanzar cierre {state.businessDate}
                </button>
              </form>
            </div>
          )}
        </section>
      )}

      {history.length > 0 && (
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-aubergine-100">
          <header className="bg-aubergine-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-aubergine-500">
            Historial
          </header>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-aubergine-500">
              <tr>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2">Inicio</th>
                <th className="px-4 py-2">Fin</th>
                <th className="px-4 py-2">Último error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-aubergine-100/70">
              {history.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-mono">{r.businessDate}</td>
                  <td className="px-4 py-2">
                    <RunStatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2 text-aubergine-700/70">
                    {r.startedAt ? r.startedAt.slice(0, 16).replace('T', ' ') : '—'}
                  </td>
                  <td className="px-4 py-2 text-aubergine-700/70">
                    {r.completedAt ? r.completedAt.slice(0, 16).replace('T', ' ') : '—'}
                  </td>
                  <td className="px-4 py-2 max-w-md truncate text-rose-700/80 text-xs">
                    {r.lastError ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function RunPanel({
  run,
  propertyId,
  businessDate,
  resumeAction,
}: {
  run: NightAuditRunSummary;
  propertyId: string;
  businessDate: string;
  resumeAction: (fd: FormData) => Promise<void>;
}) {
  const orderedSteps: NightAuditStep[] = [
    'POST_ROOM_CHARGES',
    'POST_TAXES',
    'POST_PACKAGES',
    'MARK_NO_SHOWS',
    'SNAPSHOT_REPORTS',
    'CLOSE_DAY',
  ];
  const byStep = new Map(run.steps.map((s) => [s.step, s.status]));
  return (
    <div className="mt-3 space-y-4">
      <div className="flex items-center justify-between">
        <RunStatusBadge status={run.status} />
        {run.status === 'FAILED' && (
          <form action={resumeAction}>
            <input type="hidden" name="runId" value={run.id} />
            <input type="hidden" name="propertyId" value={propertyId} />
            <input type="hidden" name="businessDate" value={businessDate} />
            <button
              type="submit"
              className="rounded-lg bg-aubergine-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-aubergine-900"
            >
              Reanudar
            </button>
          </form>
        )}
      </div>

      {run.lastError && (
        <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800 ring-1 ring-rose-100">
          <p className="font-semibold">{run.lastFailedStep}</p>
          <p className="mt-1 font-mono">{run.lastError}</p>
        </div>
      )}

      <ol className="space-y-1 text-sm">
        {orderedSteps.map((step, idx) => {
          const status = byStep.get(step) ?? 'PENDING';
          return (
            <li
              key={step}
              className="flex items-center justify-between rounded-lg border border-aubergine-100 px-3 py-2"
            >
              <span className="font-mono text-xs text-aubergine-700">
                {idx + 1}. {step.toLowerCase()}
              </span>
              <StepStatusBadge status={status} />
            </li>
          );
        })}
      </ol>

      {Object.keys(run.totals).length > 0 && (
        <details className="rounded-lg bg-aubergine-50/40 p-3 text-xs">
          <summary className="cursor-pointer font-medium text-aubergine-700">Totales</summary>
          <pre className="mt-2 overflow-auto text-aubergine-900">
            {JSON.stringify(run.totals, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

const RUN_STYLES: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-rose-100 text-rose-800',
};

function RunStatusBadge({ status }: { status: string }) {
  const cls = RUN_STYLES[status] ?? 'bg-slate-100 text-slate-700';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {status.toLowerCase().replace(/_/g, ' ')}
    </span>
  );
}

const STEP_STYLES: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  RUNNING: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-rose-100 text-rose-800',
  SKIPPED: 'bg-amber-100 text-amber-800',
};

function StepStatusBadge({ status }: { status: NightAuditStepStatus }) {
  const cls = STEP_STYLES[status] ?? 'bg-slate-100 text-slate-700';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {status.toLowerCase()}
    </span>
  );
}
