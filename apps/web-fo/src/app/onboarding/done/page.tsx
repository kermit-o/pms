import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{
    tenantId?: string;
    adminEmail?: string;
    propertySlug?: string;
    ibeUrl?: string;
    backofficeUrl?: string;
    /** Sprint 10 W1: si el wizard provisionó Keycloak, viene la password
     *  temporal aquí. Si no, el mensaje "manual fallback" se muestra. */
    kcRealm?: string;
    kcTempPassword?: string;
  }>;
}

export default async function OnboardingDonePage({ searchParams }: Props) {
  const sp = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-aubergine-50 px-6 py-12">
      <div className="w-full max-w-xl space-y-5 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-aubergine-100">
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">Aubergine</p>
        <h1 className="text-2xl font-semibold text-aubergine-700">¡Hotel creado!</h1>
        <p className="text-sm text-aubergine-700/70">
          Hemos provisionado tu instalación. Ya puedes empezar a configurar tarifas, importar
          reservas y conectar Stripe.
        </p>

        <section className="space-y-2 rounded-xl bg-aubergine-50/60 p-4 text-sm text-aubergine-700">
          <Row label="Admin" value={sp.adminEmail ?? '—'} />
          <Row label="Tenant ID" value={sp.tenantId ?? '—'} mono />
          <Row label="Slug público" value={sp.propertySlug ?? '—'} mono />
        </section>

        {sp.kcTempPassword ? (
          <section className="space-y-2 rounded-xl bg-emerald-50 p-4 text-xs text-emerald-900 ring-1 ring-emerald-200">
            <p className="font-semibold uppercase tracking-wide">Credenciales temporales</p>
            <p>
              Tu cuenta admin ya está creada. Copia esta contraseña — la pediremos al primer
              login y tendrás que cambiarla.
            </p>
            <div className="rounded-lg bg-white p-3 font-mono text-sm tracking-wider text-aubergine-900 ring-1 ring-emerald-200">
              {sp.kcTempPassword}
            </div>
            {sp.kcRealm && (
              <p className="text-[11px] opacity-80">
                Realm: <span className="font-mono">{sp.kcRealm}</span>
              </p>
            )}
          </section>
        ) : (
          <section className="space-y-2 rounded-xl bg-amber-50 p-4 text-xs text-amber-900 ring-1 ring-amber-200">
            <p className="font-semibold uppercase tracking-wide">Próximo paso</p>
            <p>
              Nuestro equipo finalizará el alta de tu usuario admin en el sistema de identidad
              (Keycloak) y te enviará las credenciales de acceso al back-office dentro de las
              próximas horas. Si llevas más de 24h sin recibirlas, escribe a{' '}
              <a href="mailto:soporte@aubergine.me" className="underline">
                soporte@aubergine.me
              </a>
              .
            </p>
          </section>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          {sp.ibeUrl && (
            <Link
              href={sp.ibeUrl}
              className="flex-1 rounded-xl bg-white px-4 py-3 text-center text-sm font-semibold text-aubergine-700 ring-1 ring-aubergine-200 hover:bg-aubergine-50"
            >
              Ver mi IBE público
            </Link>
          )}
          <Link
            href={sp.backofficeUrl || '/login'}
            className="flex-1 rounded-xl bg-aubergine-700 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-aubergine-800"
          >
            Ir al back-office
          </Link>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <p className="flex items-center justify-between gap-2">
      <span className="text-xs uppercase tracking-wide text-aubergine-500">{label}</span>
      <span className={mono ? 'font-mono text-xs' : 'font-medium'}>{value}</span>
    </p>
  );
}
