import { signIn } from '@/auth';

export default function LoginPage({ searchParams }: { searchParams: { callbackUrl?: string } }) {
  const callbackUrl = searchParams.callbackUrl ?? '/';

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form
        action={async () => {
          'use server';
          await signIn('keycloak', { redirectTo: callbackUrl });
        }}
        className="w-full max-w-sm space-y-6 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-aubergine-100"
      >
        <header className="space-y-1 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">Aubergine</p>
          <h1 className="text-2xl font-semibold text-aubergine-700">Housekeeping</h1>
          <p className="text-sm text-aubergine-700/70">Inicia sesión con tu cuenta.</p>
        </header>
        <button
          type="submit"
          className="w-full rounded-xl bg-aubergine-600 py-3 text-base font-medium text-white transition hover:bg-aubergine-700"
        >
          Continuar
        </button>
        <p className="text-center text-xs text-aubergine-700/60">
          Login PIN + scan QR llegarán en S4-W4.
        </p>
      </form>
    </main>
  );
}
