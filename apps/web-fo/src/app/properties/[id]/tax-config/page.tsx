import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import {
  ApiError,
  getCityTaxRule,
  getPropertyTaxConfig,
  updatePropertyTaxRate,
  upsertCityTaxRule,
  type CityTaxRegion,
  type CityTaxRuleView,
  type PropertyTaxConfigEntry,
  type TaxCategory,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

const CATEGORY_LABELS: Record<TaxCategory, { label: string; help: string }> = {
  ROOM: { label: 'Habitación', help: 'IVA reducido alojamiento (default 10%)' },
  BREAKFAST: { label: 'Desayuno', help: 'Hostelería (default 10%)' },
  EXTRA_FOOD: { label: 'Restauración', help: 'Hostelería (default 10%)' },
  EXTRA_OTHER: { label: 'Otros', help: 'Parking, lavandería, wellness (default 21%)' },
  CITY_TAX: { label: 'City tax', help: 'Impuesto autonómico — fuera del IVA (0%)' },
  EXEMPT: { label: 'Exento', help: 'Cortesía, compensación, sin contraprestación' },
};

const REGION_LABELS: Record<CityTaxRegion, string> = {
  NONE: 'Sin city tax',
  CATALUNYA: 'Cataluña',
  BALEARES: 'Islas Baleares',
  COMUNIDAD_VALENCIANA: 'Comunidad Valenciana',
};

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    section?: 'iva' | 'city';
    status?: 'ok' | 'fail' | 'invalid';
  }>;
}

export default async function PropertyTaxConfigPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.accessToken) redirect(`/login?callbackUrl=/properties/${id}/tax-config`);

  let matrix: PropertyTaxConfigEntry[];
  let cityRule: CityTaxRuleView | null;
  try {
    [matrix, cityRule] = await Promise.all([
      getPropertyTaxConfig(session.accessToken, id),
      getCityTaxRule(session.accessToken, id),
    ]);
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

  async function updateRateAction(formData: FormData) {
    'use server';
    const session = await auth();
    if (!session?.accessToken) redirect('/login');
    const category = String(formData.get('category') ?? '') as TaxCategory;
    const rate = Number(formData.get('rate') ?? '');
    if (Number.isNaN(rate) || rate < 0 || rate > 100) {
      redirect(`/properties/${id}/tax-config?section=iva&status=invalid`);
    }
    try {
      await updatePropertyTaxRate(session.accessToken, id, category, rate);
      redirect(`/properties/${id}/tax-config?section=iva&status=ok#iva`);
    } catch {
      redirect(`/properties/${id}/tax-config?section=iva&status=fail#iva`);
    }
  }

  async function upsertCityTaxAction(formData: FormData) {
    'use server';
    const session = await auth();
    if (!session?.accessToken) redirect('/login');
    const region = (String(formData.get('region') ?? 'NONE') as CityTaxRegion) ?? 'NONE';
    const amountPerNight = Number(formData.get('amountPerNight') ?? '0');
    const appliesToAdults = formData.get('appliesToAdults') === 'on';
    const appliesToChildren = formData.get('appliesToChildren') === 'on';
    const childAgeThreshold = Number(formData.get('childAgeThreshold') ?? '16');
    const maxNights = Number(formData.get('maxNights') ?? '7');
    if (Number.isNaN(amountPerNight) || amountPerNight < 0) {
      redirect(`/properties/${id}/tax-config?section=city&status=invalid#city`);
    }
    try {
      await upsertCityTaxRule(session.accessToken, id, {
        region,
        amountPerNight,
        appliesToAdults,
        appliesToChildren,
        childAgeThreshold,
        maxNights,
      });
      redirect(`/properties/${id}/tax-config?section=city&status=ok#city`);
    } catch {
      redirect(`/properties/${id}/tax-config?section=city&status=fail#city`);
    }
  }

  const matrixByCategory = new Map<TaxCategory, PropertyTaxConfigEntry>();
  for (const row of matrix) matrixByCategory.set(row.category, row);

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Configuración fiscal
        </p>
        <h1 className="text-2xl font-semibold text-aubergine-700">IVA + City Tax</h1>
        <p className="text-sm text-aubergine-700/70">
          Property <span className="font-mono text-xs">{id}</span>. Los cambios se aplican
          desde hoy; folios cerrados antes de la fecha mantienen los rates anteriores.
        </p>
        <nav className="mt-3 flex gap-3 text-xs">
          <Link
            href={`/properties/${id}/settings`}
            className="rounded-full bg-aubergine-50 px-3 py-1 text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-100"
          >
            ← Property settings
          </Link>
          <Link
            href={`/properties/${id}/rate-plans`}
            className="rounded-full bg-aubergine-50 px-3 py-1 text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-100"
          >
            Rate plans
          </Link>
        </nav>
      </header>

      <Status section="iva" sp={sp} />

      <section
        id="iva"
        className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100"
      >
        <h2 className="text-lg font-semibold text-aubergine-700">Matriz IVA por categoría</h2>
        <p className="text-xs text-aubergine-700/70">
          El % IVA por defecto se aplica cuando el front-desk añade un cargo sin override.
        </p>
        <div className="overflow-hidden rounded-xl ring-1 ring-aubergine-100">
          <table className="w-full text-sm">
            <thead className="bg-aubergine-50 text-left text-xs uppercase tracking-wide text-aubergine-500">
              <tr>
                <th className="px-3 py-2">Categoría</th>
                <th className="px-3 py-2 text-right">% IVA actual</th>
                <th className="px-3 py-2">Vigente desde</th>
                <th className="px-3 py-2">Editar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-aubergine-100/70">
              {(Object.keys(CATEGORY_LABELS) as TaxCategory[]).map((cat) => {
                const row = matrixByCategory.get(cat);
                const meta = CATEGORY_LABELS[cat];
                return (
                  <tr key={cat}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-aubergine-900">{meta.label}</div>
                      <div className="text-xs text-aubergine-700/60">{meta.help}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-aubergine-900">
                      {row ? `${trimDecimal(row.taxRate)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-aubergine-700/70">
                      {row?.effectiveFrom ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <form action={updateRateAction} className="flex items-center gap-2">
                        <input type="hidden" name="category" value={cat} />
                        <input
                          name="rate"
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          defaultValue={row ? trimDecimal(row.taxRate) : ''}
                          className="w-20 rounded-md border border-aubergine-100 bg-white px-2 py-1 text-right text-sm focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
                          required
                        />
                        <button
                          type="submit"
                          className="rounded-md bg-aubergine-700 px-3 py-1 text-xs font-medium text-white hover:bg-aubergine-800"
                        >
                          Guardar
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Status section="city" sp={sp} />

      <section
        id="city"
        className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100"
      >
        <h2 className="text-lg font-semibold text-aubergine-700">Regla de city tax</h2>
        <p className="text-xs text-aubergine-700/70">
          El night audit aplica el city tax automáticamente cada noche que la reserva
          está CHECKED_IN, respetando exenciones y el cap de noches. Pon importe 0 si
          tu autonomía no lo cobra.
        </p>

        <form action={upsertCityTaxAction} className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            Autonomía
            <select
              name="region"
              defaultValue={cityRule?.region ?? 'NONE'}
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base font-normal text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
            >
              {(Object.keys(REGION_LABELS) as CityTaxRegion[]).map((r) => (
                <option key={r} value={r}>
                  {REGION_LABELS[r]}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            Importe por noche y pax (€)
            <input
              name="amountPerNight"
              type="number"
              step="0.01"
              min="0"
              max="99.99"
              defaultValue={cityRule ? trimDecimal(cityRule.amountPerNight) : '0'}
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base font-normal text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
              required
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-aubergine-900">
            <input
              type="checkbox"
              name="appliesToAdults"
              defaultChecked={cityRule?.appliesToAdults ?? true}
            />
            Cobrar a adultos
          </label>

          <label className="flex items-center gap-2 text-sm text-aubergine-900">
            <input
              type="checkbox"
              name="appliesToChildren"
              defaultChecked={cityRule?.appliesToChildren ?? false}
            />
            Cobrar a niños (a partir de la edad mínima)
          </label>

          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            Edad mínima de niño cobrable
            <input
              name="childAgeThreshold"
              type="number"
              min="0"
              max="99"
              defaultValue={cityRule?.childAgeThreshold ?? 16}
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base font-normal text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
              required
            />
          </label>

          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            Máximo de noches cobrables (0 = sin tope)
            <input
              name="maxNights"
              type="number"
              min="0"
              max="99"
              defaultValue={cityRule?.maxNights ?? 7}
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base font-normal text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
              required
            />
          </label>

          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-xl bg-aubergine-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-aubergine-800"
            >
              {cityRule ? 'Actualizar regla' : 'Crear regla'}
            </button>
          </div>
        </form>
      </section>

      <p className="text-center">
        <Link href="/dashboard" className="text-xs text-aubergine-700/70 underline">
          ← Volver al dashboard
        </Link>
      </p>
    </main>
  );
}

function trimDecimal(v: string): string {
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return n.toString();
}

function Status({
  section,
  sp,
}: {
  section: 'iva' | 'city';
  sp: { section?: string; status?: string };
}) {
  if (sp.section !== section || !sp.status) return null;
  if (sp.status === 'ok') return <Banner kind="success">Guardado.</Banner>;
  if (sp.status === 'invalid') {
    return <Banner kind="error">Valor inválido. Revisa importes y porcentajes.</Banner>;
  }
  return <Banner kind="error">No pudimos guardar. Reintenta.</Banner>;
}

function Banner({ kind, children }: { kind: 'success' | 'error'; children: React.ReactNode }) {
  const cls =
    kind === 'success'
      ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
      : 'bg-rose-50 text-rose-900 ring-rose-200';
  return <div className={`rounded-xl px-4 py-3 text-sm ring-1 ${cls}`}>{children}</div>;
}
