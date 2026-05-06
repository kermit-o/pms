import { LoginQrForm } from './login-qr-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { tenantId?: string; code?: string };
}

export default function LoginQrPage({ searchParams }: PageProps) {
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">Aubergine</p>
        <h1 className="text-2xl font-semibold text-aubergine-700">Iniciar turno</h1>
        <p className="text-sm text-aubergine-700/70">
          Pídele a tu supervisora un código de emparejamiento.
        </p>
      </header>

      <LoginQrForm
        initialTenantId={searchParams.tenantId ?? ''}
        initialCode={searchParams.code ?? ''}
      />
    </main>
  );
}
