import Link from 'next/link';
import { PairForm } from './pair-form';

export const dynamic = 'force-dynamic';

export default function PairPage() {
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <Link
        href="/supervisor"
        className="inline-flex items-center text-sm text-aubergine-600 hover:underline"
      >
        ← Supervisor
      </Link>

      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">Aubergine</p>
        <h1 className="text-2xl font-semibold text-aubergine-700">Emparejar dispositivo</h1>
        <p className="text-sm text-aubergine-700/70">
          Genera un código de un solo uso para iniciar sesión a una camarera en un móvil compartido.
        </p>
      </header>

      <PairForm />
    </main>
  );
}
