import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function ManageRedirectPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <h1 className="text-xl font-semibold text-aubergine-700">
        Gestiona tu reserva
      </h1>
      <p className="text-sm text-aubergine-700/70">
        Indica el código del hotel donde reservaste y a continuación tu código + apellido.
      </p>
      <form action="/h" method="get" className="flex w-full gap-2">
        <input
          name="slug"
          required
          placeholder="código-del-hotel"
          className="flex-1 rounded-xl border border-aubergine-100 bg-white px-3 py-2 text-base focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
        />
        <button
          type="submit"
          className="rounded-xl bg-aubergine-700 px-4 py-2 text-sm font-semibold text-white"
        >
          Continuar
        </button>
      </form>
      <Link href="/" className="text-xs text-aubergine-700 underline">
        Volver
      </Link>
    </main>
  );
}
