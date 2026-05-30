import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { auth } from '@/auth';
import { ApiError, type EmisorData, getEmisor, updateEmisor } from '@/lib/api';

export const dynamic = 'force-dynamic';

const RUTA = '/admin/billing/emisor';

export default async function EmisorPage() {
  const session = await auth();

  let emisor: EmisorData = { nif: null, razonSocial: null };
  let loadError: string | null = null;
  try {
    emisor = await getEmisor(session?.accessToken);
  } catch (err) {
    loadError = err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
  }

  async function saveAction(formData: FormData) {
    'use server';
    const session = await auth();
    const nif = formData.get('nif')?.toString().trim().toUpperCase();
    const razonSocial = formData.get('razonSocial')?.toString().trim();
    if (!nif || !/^[A-Z0-9]{9}$/.test(nif)) {
      throw new Error('NIF debe tener 9 caracteres alfanuméricos');
    }
    if (!razonSocial) throw new Error('Razón social obligatoria');
    try {
      await updateEmisor(session?.accessToken, { nif, razonSocial });
    } catch (err) {
      if (err instanceof ApiError) {
        throw new Error(`API ${err.status}: ${err.body || err.message}`);
      }
      throw err;
    }
    revalidatePath(RUTA);
  }

  const isComplete = emisor.nif && emisor.razonSocial;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Facturación
        </p>
        <h1 className="text-3xl font-semibold text-aubergine-700">Datos del emisor</h1>
        <p className="text-sm text-aubergine-700/70">
          NIF + razón social que aparecerán como emisor en todas las facturas Verifactu de
          este tenant. <strong>Sin estos datos no se pueden emitir facturas</strong> — el
          backend rechazará la operación.
        </p>
        <p className="text-sm text-aubergine-700/70">
          ¿Necesitas configurar también el certificado digital?{' '}
          <Link href="/admin/billing/certificate" className="text-aubergine-700 underline">
            Ir a Certificado
          </Link>
          .
        </p>
      </header>

      {loadError && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {loadError}
        </div>
      )}

      {!isComplete && (
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-100">
          Emisor sin configurar. Rellena los campos para habilitar la emisión de facturas.
        </div>
      )}

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100">
        <form action={saveAction} className="space-y-4">
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-wide text-aubergine-500">NIF *</span>
            <input
              name="nif"
              type="text"
              required
              defaultValue={emisor.nif ?? ''}
              maxLength={9}
              pattern="[A-Za-z0-9]{9}"
              title="9 caracteres alfanuméricos (NIF, CIF o NIE)"
              className="mt-1 block w-48 rounded-lg border border-aubergine-100 bg-white px-3 py-2 font-mono text-sm focus:border-aubergine-500 focus:outline-none"
            />
            <span className="mt-1 block text-xs text-aubergine-700/60">
              9 caracteres. Acepta NIF (8 dígitos + letra), CIF (letra + 7 + dígito/letra) y
              NIE (X/Y/Z + 7 + letra). Se guarda en mayúsculas.
            </span>
          </label>
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-wide text-aubergine-500">
              Razón social *
            </span>
            <input
              name="razonSocial"
              type="text"
              required
              defaultValue={emisor.razonSocial ?? ''}
              maxLength={200}
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
            />
            <span className="mt-1 block text-xs text-aubergine-700/60">
              Nombre comercial o razón social tal como figura en el registro mercantil.
            </span>
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-aubergine-700 px-4 py-2 text-sm font-medium text-white hover:bg-aubergine-900"
            >
              Guardar
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
