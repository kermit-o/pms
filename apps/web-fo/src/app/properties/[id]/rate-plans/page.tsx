import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import {
  ApiError,
  createRatePlan,
  listRatePlans,
  updateRatePlan,
  type RatePlanListItem,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    status?: 'created' | 'updated' | 'collision' | 'fail';
    editing?: string;
  }>;
}

/**
 * Sprint 13 W2 — Admin UI para gestión de rate plans por propiedad.
 *
 * Roles: `tenant_admin` para crear/editar; cualquiera con sesión puede
 * leer (el API impone la restricción real). Sin tabla compleja: un row
 * por rate plan, con form inline al pulsar "Editar".
 */
export default async function RatePlansPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.accessToken)
    redirect(`/login?callbackUrl=/properties/${id}/rate-plans`);

  let plans: RatePlanListItem[];
  try {
    plans = await listRatePlans(session.accessToken, id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return (
        <main className="mx-auto max-w-3xl px-6 py-10">
          <Banner kind="error">No encontramos esta property.</Banner>
        </main>
      );
    }
    throw err;
  }

  async function createAction(formData: FormData) {
    'use server';
    const session = await auth();
    if (!session?.accessToken) redirect('/login');
    const code = String(formData.get('code') ?? '').trim().toUpperCase();
    const name = String(formData.get('name') ?? '').trim();
    const description =
      String(formData.get('description') ?? '').trim() || undefined;
    const nonRefundable = formData.get('nonRefundable') === 'on';
    const discountRaw = String(formData.get('discountPct') ?? '').trim();
    const dailyRateRaw = String(formData.get('dailyRate') ?? '').trim();
    const isPublic = formData.get('isPublic') !== 'off';

    if (!code || !name) {
      redirect(`/properties/${id}/rate-plans?status=fail`);
    }
    try {
      await createRatePlan(session.accessToken, id, {
        code,
        name,
        description,
        isPublic,
        nonRefundable,
        ...(discountRaw ? { discountPct: Number(discountRaw) } : {}),
        ...(dailyRateRaw ? { dailyRate: Number(dailyRateRaw) } : {}),
      });
      redirect(`/properties/${id}/rate-plans?status=created`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        redirect(`/properties/${id}/rate-plans?status=collision`);
      }
      redirect(`/properties/${id}/rate-plans?status=fail`);
    }
  }

  async function updateAction(formData: FormData) {
    'use server';
    const session = await auth();
    if (!session?.accessToken) redirect('/login');
    const ratePlanId = String(formData.get('id') ?? '');
    if (!ratePlanId) redirect(`/properties/${id}/rate-plans?status=fail`);
    const name = String(formData.get('name') ?? '').trim() || undefined;
    const description =
      String(formData.get('description') ?? '').trim() || undefined;
    const nonRefundable = formData.get('nonRefundable') === 'on';
    const isPublic = formData.get('isPublic') === 'on';
    const discountRaw = String(formData.get('discountPct') ?? '').trim();
    const dailyRateRaw = String(formData.get('dailyRate') ?? '').trim();
    try {
      await updateRatePlan(session.accessToken, ratePlanId, {
        name,
        description,
        isPublic,
        nonRefundable,
        discountPct: discountRaw === '' ? null : Number(discountRaw),
        dailyRate: dailyRateRaw === '' ? null : Number(dailyRateRaw),
      });
      redirect(`/properties/${id}/rate-plans?status=updated`);
    } catch {
      redirect(`/properties/${id}/rate-plans?status=fail`);
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <Link
        href={`/properties/${id}/settings`}
        className="text-sm text-aubergine-500 hover:underline"
      >
        ← Volver a configuración
      </Link>
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Configuración
        </p>
        <h1 className="text-3xl font-semibold text-aubergine-700">Rate plans</h1>
        <p className="mt-1 text-sm text-aubergine-700/70">
          Tarifas vendibles en el IBE. Una propiedad sin rate plans configurados
          muestra automáticamente la tarifa flexible base.
        </p>
      </header>

      {sp.status === 'created' && (
        <Banner kind="success">Rate plan creado.</Banner>
      )}
      {sp.status === 'updated' && (
        <Banner kind="success">Rate plan actualizado.</Banner>
      )}
      {sp.status === 'collision' && (
        <Banner kind="error">Ya existe un rate plan con ese código en esta propiedad.</Banner>
      )}
      {sp.status === 'fail' && (
        <Banner kind="error">No se pudo guardar. Revisa los campos y vuelve a intentarlo.</Banner>
      )}

      {/* Existing rate plans */}
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-aubergine-100">
        <table className="w-full text-sm">
          <thead className="bg-aubergine-50 text-left text-xs uppercase tracking-wide text-aubergine-500">
            <tr>
              <th className="px-4 py-2">Código</th>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Tarifa fija</th>
              <th className="px-4 py-2">Descuento</th>
              <th className="px-4 py-2">No reembolsable</th>
              <th className="px-4 py-2">Público</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-aubergine-100/70">
            {plans.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-aubergine-700/60">
                  Aún no hay rate plans. Crea el primero abajo.
                </td>
              </tr>
            )}
            {plans.map((p) => {
              const fixedDailyRate =
                p.attributes && typeof p.attributes === 'object' && !Array.isArray(p.attributes)
                  ? (p.attributes as Record<string, unknown>).dailyRate
                  : undefined;
              const editing = sp.editing === p.id;
              if (editing) {
                return (
                  <tr key={p.id} className="bg-aubergine-50/30">
                    <td className="px-4 py-3 font-mono">{p.code}</td>
                    <td colSpan={6} className="px-4 py-3">
                      <form action={updateAction} className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                        <input type="hidden" name="id" value={p.id} />
                        <label className="col-span-2 text-xs text-aubergine-500">
                          Nombre
                          <input
                            name="name"
                            defaultValue={p.name}
                            required
                            className="mt-1 block w-full rounded-lg border border-aubergine-100 px-2 py-1 text-sm"
                          />
                        </label>
                        <label className="col-span-2 text-xs text-aubergine-500">
                          Descripción
                          <input
                            name="description"
                            defaultValue={p.description ?? ''}
                            className="mt-1 block w-full rounded-lg border border-aubergine-100 px-2 py-1 text-sm"
                          />
                        </label>
                        <label className="text-xs text-aubergine-500">
                          Tarifa fija ({p.currency})
                          <input
                            name="dailyRate"
                            type="number"
                            step="0.01"
                            min="0"
                            defaultValue={
                              typeof fixedDailyRate === 'number' || typeof fixedDailyRate === 'string'
                                ? String(fixedDailyRate)
                                : ''
                            }
                            className="mt-1 block w-full rounded-lg border border-aubergine-100 px-2 py-1 text-sm"
                          />
                        </label>
                        <label className="text-xs text-aubergine-500">
                          Descuento %
                          <input
                            name="discountPct"
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            defaultValue={p.discountPct ?? ''}
                            className="mt-1 block w-full rounded-lg border border-aubergine-100 px-2 py-1 text-sm"
                          />
                        </label>
                        <label className="flex items-center gap-2 text-xs text-aubergine-700">
                          <input
                            type="checkbox"
                            name="nonRefundable"
                            defaultChecked={p.nonRefundable}
                          />
                          No reembolsable
                        </label>
                        <label className="flex items-center gap-2 text-xs text-aubergine-700">
                          <input
                            type="checkbox"
                            name="isPublic"
                            defaultChecked={p.isPublic}
                          />
                          Visible en IBE
                        </label>
                        <div className="col-span-2 flex gap-2 sm:col-span-6">
                          <button
                            type="submit"
                            className="rounded-lg bg-aubergine-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-aubergine-800"
                          >
                            Guardar
                          </button>
                          <Link
                            href={`/properties/${id}/rate-plans`}
                            className="rounded-lg bg-white px-3 py-1.5 text-xs text-aubergine-700 ring-1 ring-aubergine-100"
                          >
                            Cancelar
                          </Link>
                        </div>
                      </form>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={p.id}>
                  <td className="px-4 py-2 font-mono text-aubergine-700">{p.code}</td>
                  <td className="px-4 py-2">
                    {p.name}
                    {p.description && (
                      <p className="text-[11px] text-aubergine-700/60">{p.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-2 text-aubergine-700/70">
                    {typeof fixedDailyRate === 'number' || typeof fixedDailyRate === 'string'
                      ? `${Number(fixedDailyRate).toFixed(2)} ${p.currency}`
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-aubergine-700/70">
                    {p.discountPct ? `−${Number(p.discountPct).toFixed(0)}%` : '—'}
                  </td>
                  <td className="px-4 py-2">
                    {p.nonRefundable ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                        SÍ
                      </span>
                    ) : (
                      <span className="text-aubergine-700/40">No</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {p.isPublic ? (
                      <span className="text-emerald-700">Sí</span>
                    ) : (
                      <span className="text-aubergine-700/40">Oculto</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/properties/${id}/rate-plans?editing=${p.id}`}
                      className="text-xs text-aubergine-700 hover:underline"
                    >
                      Editar
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Create new rate plan */}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100">
        <h2 className="text-base font-semibold text-aubergine-700">Crear rate plan</h2>
        <p className="mt-1 text-xs text-aubergine-700/60">
          El código sirve como identificador interno (ej. <code>BAR</code>,{' '}
          <code>NRF10</code>). Sólo A-Z, 0-9, <code>_</code>, <code>-</code>; máx 16 caracteres.
        </p>
        <form action={createAction} className="mt-4 grid gap-3 sm:grid-cols-6">
          <Field
            name="code"
            label="Código"
            placeholder="NRF10"
            required
            pattern="[A-Z][A-Z0-9_-]{0,15}"
            className="col-span-1"
          />
          <Field
            name="name"
            label="Nombre"
            placeholder="No reembolsable −10%"
            required
            className="col-span-3"
          />
          <Field
            name="discountPct"
            label="Descuento %"
            type="number"
            min="0"
            max="100"
            step="0.01"
            className="col-span-1"
          />
          <Field
            name="dailyRate"
            label="Tarifa fija opcional"
            type="number"
            step="0.01"
            min="0"
            className="col-span-1"
          />
          <Field
            name="description"
            label="Descripción (opc.)"
            className="col-span-6"
          />
          <label className="col-span-3 flex items-center gap-2 text-xs text-aubergine-700">
            <input type="checkbox" name="nonRefundable" />
            No reembolsable (exige pago upfront)
          </label>
          <label className="col-span-3 flex items-center gap-2 text-xs text-aubergine-700">
            <input type="checkbox" name="isPublic" defaultChecked />
            Visible en IBE (público)
          </label>
          <div className="col-span-6">
            <button
              type="submit"
              className="rounded-lg bg-aubergine-700 px-4 py-2 text-sm font-semibold text-white hover:bg-aubergine-800"
            >
              Crear rate plan
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

function Field({
  label,
  name,
  className,
  ...rest
}: {
  label: string;
  name: string;
  className?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`text-xs font-medium uppercase tracking-wide text-aubergine-500 ${className ?? ''}`}>
      {label}
      <input
        name={name}
        {...rest}
        className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm font-normal normal-case text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
      />
    </label>
  );
}

function Banner({ kind, children }: { kind: 'success' | 'error'; children: React.ReactNode }) {
  const cls =
    kind === 'success'
      ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
      : 'bg-rose-50 text-rose-900 ring-rose-200';
  return <div className={`rounded-xl px-4 py-3 text-sm ring-1 ${cls}`}>{children}</div>;
}
