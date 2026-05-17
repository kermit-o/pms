import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <h1 className="text-3xl font-semibold text-aubergine-700 sm:text-4xl">
        Aubergine — reserva directa
      </h1>
      <p className="text-sm text-aubergine-700/70">
        Cada hotel tiene su propia página. Si conoces el código, ve directamente:
      </p>
      <form
        action="/h"
        className="flex w-full flex-col gap-3 sm:flex-row"
      >
        <input
          name="slug"
          required
          placeholder="código-del-hotel"
          className="flex-1 rounded-xl border border-aubergine-100 bg-white px-4 py-3 text-base focus:border-aubergine-500 focus:outline-none focus:ring-2 focus:ring-aubergine-500"
        />
        <button
          type="submit"
          className="rounded-xl bg-aubergine-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-aubergine-800"
        >
          Ir
        </button>
      </form>
      <p className="text-xs text-aubergine-700/50">
        ¿Tienes una reserva?{' '}
        <Link href="/manage" className="underline hover:text-aubergine-700">
          Gestiónala aquí
        </Link>
      </p>
    </main>
  );
}
