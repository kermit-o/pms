import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import {
  ApiError,
  getPropertySettings,
  setPropertyBlockedIps,
  setPropertyChannelManager,
  setPropertyPublish,
  type PropertySettings,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

const IBE_BASE = process.env.NEXT_PUBLIC_IBE_BASE_URL ?? 'https://pms-web-ibe.fly.dev';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    section?: 'ibe' | 'cm' | 'ips';
    status?: 'ok' | 'collision' | 'fail' | 'invalid';
  }>;
}

export default async function PropertySettingsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.accessToken) redirect(`/login?callbackUrl=/properties/${id}/settings`);

  let settings: PropertySettings;
  try {
    settings = await getPropertySettings(session.accessToken, id);
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

  async function publishAction(formData: FormData) {
    'use server';
    const session = await auth();
    if (!session?.accessToken) redirect('/login');
    const publish = formData.get('publish') === 'true';
    const slug = String(formData.get('slug') ?? '').trim() || undefined;
    try {
      await setPropertyPublish(session.accessToken, id, { publish, slug });
      redirect(`/properties/${id}/settings?section=ibe&status=ok`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        redirect(`/properties/${id}/settings?section=ibe&status=collision`);
      }
      redirect(`/properties/${id}/settings?section=ibe&status=fail`);
    }
  }

  async function channelManagerAction(formData: FormData) {
    'use server';
    const session = await auth();
    if (!session?.accessToken) redirect('/login');
    const providerRaw = String(formData.get('provider') ?? '');
    const provider = providerRaw === 'siteminder' ? ('siteminder' as const) : null;
    const channelManagerPropertyId =
      String(formData.get('cmPropertyId') ?? '').trim() || null;
    const credentialsRef = String(formData.get('credentialsRef') ?? '').trim() || null;
    try {
      await setPropertyChannelManager(session.accessToken, id, {
        provider,
        channelManagerPropertyId,
        credentialsRef,
      });
      redirect(`/properties/${id}/settings?section=cm&status=ok`);
    } catch {
      redirect(`/properties/${id}/settings?section=cm&status=fail`);
    }
  }

  async function blockedIpsAction(formData: FormData) {
    'use server';
    const session = await auth();
    if (!session?.accessToken) redirect('/login');
    const raw = String(formData.get('ips') ?? '');
    const ips = raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await setPropertyBlockedIps(session.accessToken, id, ips);
      redirect(`/properties/${id}/settings?section=ips&status=ok`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        redirect(`/properties/${id}/settings?section=ips&status=invalid`);
      }
      redirect(`/properties/${id}/settings?section=ips&status=fail`);
    }
  }

  const published = settings.ibe.publishedAt !== null;

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Property settings
        </p>
        <h1 className="text-2xl font-semibold text-aubergine-700">{settings.name}</h1>
        <p className="text-sm text-aubergine-700/70">
          Código <span className="font-mono">{settings.code}</span> · ID{' '}
          <span className="font-mono text-xs">{settings.id}</span>
        </p>
      </header>

      <Status section="ibe" sp={sp} />

      <section id="ibe" className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100">
        <h2 className="text-lg font-semibold text-aubergine-700">Booking Engine (IBE)</h2>
        <p className="text-xs text-aubergine-700/70">
          {published ? (
            <>
              Publicado como{' '}
              <a
                href={`${IBE_BASE}/h/${settings.ibe.publicSlug}`}
                className="font-mono text-aubergine-700 underline"
              >
                /h/{settings.ibe.publicSlug}
              </a>
              .
            </>
          ) : (
            <>El IBE está sin publicar — el huésped no puede reservar directamente.</>
          )}
        </p>
        <form action={publishAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {!published && !settings.ibe.publicSlug && (
            <label className="flex-1 text-xs uppercase tracking-wide text-aubergine-500">
              Slug público (opcional — auto si está vacío)
              <input
                name="slug"
                placeholder="hotel-berenjena"
                className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base font-normal lowercase text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
              />
            </label>
          )}
          <input type="hidden" name="publish" value={String(!published)} />
          <button
            type="submit"
            className={`rounded-xl px-5 py-2.5 text-sm font-semibold text-white ${
              published ? 'bg-rose-700 hover:bg-rose-800' : 'bg-emerald-700 hover:bg-emerald-800'
            }`}
          >
            {published ? 'Despublicar IBE' : 'Publicar IBE'}
          </button>
        </form>
      </section>

      <Status section="cm" sp={sp} />

      <section id="cm" className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100">
        <h2 className="text-lg font-semibold text-aubergine-700">Channel Manager</h2>
        <p className="text-xs text-aubergine-700/70">
          Sincroniza disponibilidad y tarifas con tu CM. Deja en blanco para desactivar.
        </p>
        <form action={channelManagerAction} className="space-y-3">
          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            Provider
            <select
              name="provider"
              defaultValue={settings.channelManager.provider ?? ''}
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base font-normal text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
            >
              <option value="">(ninguno)</option>
              <option value="siteminder">SiteMinder</option>
            </select>
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            CM Property ID
            <input
              name="cmPropertyId"
              defaultValue={settings.channelManager.channelManagerPropertyId ?? ''}
              placeholder="id que asigna el CM"
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base font-normal normal-case text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
            />
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            Credentials Ref (nombre del Fly secret)
            <input
              name="credentialsRef"
              defaultValue={settings.channelManager.credentialsRef ?? ''}
              placeholder="CM_SITEMINDER_HMAC_SECRET"
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-base font-normal text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
            />
          </label>
          <button
            type="submit"
            className="rounded-xl bg-aubergine-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-aubergine-800"
          >
            Guardar
          </button>
        </form>
      </section>

      <Status section="ips" sp={sp} />

      <section id="ips" className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-aubergine-100">
        <h2 className="text-lg font-semibold text-aubergine-700">IPs bloqueadas</h2>
        <p className="text-xs text-aubergine-700/70">
          Una IP por línea (IPv4 o IPv6). Las requests al IBE desde estas IPs reciben 403.
        </p>
        <form action={blockedIpsAction} className="space-y-3">
          <textarea
            name="ips"
            rows={6}
            defaultValue={settings.blockedIps.join('\n')}
            placeholder="1.2.3.4&#10;5.6.7.8"
            className="block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 font-mono text-sm text-aubergine-900 focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
          />
          <button
            type="submit"
            className="rounded-xl bg-aubergine-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-aubergine-800"
          >
            Guardar lista ({settings.blockedIps.length})
          </button>
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

function Status({
  section,
  sp,
}: {
  section: 'ibe' | 'cm' | 'ips';
  sp: { section?: string; status?: string };
}) {
  if (sp.section !== section || !sp.status) return null;
  if (sp.status === 'ok') {
    return <Banner kind="success">Guardado.</Banner>;
  }
  if (sp.status === 'collision') {
    return <Banner kind="error">Ese slug ya está en uso por otro hotel.</Banner>;
  }
  if (sp.status === 'invalid') {
    return <Banner kind="error">Alguna IP no es válida (debe ser IPv4 o IPv6).</Banner>;
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
