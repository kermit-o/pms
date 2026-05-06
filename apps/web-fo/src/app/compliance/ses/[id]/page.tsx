import Link from 'next/link';
import { auth } from '@/auth';
import { ApiError, getSesSubmission } from '@/lib/api';
import type { SesSubmissionDetail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function SesSubmissionDetailPage({ params }: { params: { id: string } }) {
  const session = await auth();
  let detail: SesSubmissionDetail | null = null;
  let error: string | null = null;
  try {
    detail = await getSesSubmission(session?.accessToken, params.id);
  } catch (err) {
    error = err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
  }

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/compliance/ses" className="text-sm text-aubergine-500 hover:underline">
          ← Volver a envíos
        </Link>
        <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      </main>
    );
  }
  if (!detail) return null;

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <Link
        href={`/compliance/ses?propertyId=${detail.propertyId}`}
        className="text-sm text-aubergine-500 hover:underline"
      >
        ← Volver a envíos
      </Link>

      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · SES.HOSPEDAJES
        </p>
        <h1 className="font-mono text-2xl font-semibold text-aubergine-700">
          {detail.businessDate}
        </h1>
        <p className="text-sm text-aubergine-700/70">
          Estado: {detail.status} · Intentos: {detail.retryCount}/5
        </p>
      </header>

      {detail.lastError && (
        <section className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-800 ring-1 ring-rose-100">
          <p className="font-semibold">Último error</p>
          <p className="mt-1 font-mono text-xs">{detail.lastError}</p>
        </section>
      )}

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-aubergine-500">
          Respuesta
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-aubergine-900">
          <Item label="Código HTTP" value={detail.responseCode ?? '—'} />
          <Item label="Enviado" value={detail.submittedAt ?? 'pendiente'} />
          {detail.responseBody && (
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wide text-aubergine-500">Cuerpo</dt>
              <dd className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-aubergine-50/50 p-2 font-mono text-xs">
                {detail.responseBody}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-aubergine-500">
          XML payload
        </h2>
        <p className="mt-1 text-xs text-aubergine-700/60">
          SHA-256: <code className="font-mono">{detail.xmlSignature ?? '—'}</code>
        </p>
        <pre className="mt-3 max-h-[480px] overflow-auto rounded-lg bg-aubergine-50/40 p-3 font-mono text-xs leading-relaxed">
          {detail.xmlPayload ?? '(sin payload)'}
        </pre>
      </section>
    </main>
  );
}

function Item({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-aubergine-500">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
