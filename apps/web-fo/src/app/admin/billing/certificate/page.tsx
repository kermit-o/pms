import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  ApiError,
  type CertificateMetadata,
  getCertificate,
  revokeCertificate,
  uploadCertificate,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

const RUTA = '/admin/billing/certificate';

export default async function CertificatePage() {
  const session = await auth();

  let cert: CertificateMetadata | null = null;
  let loadError: string | null = null;
  try {
    cert = await getCertificate(session?.accessToken);
  } catch (err) {
    loadError = err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
  }

  async function uploadAction(formData: FormData) {
    'use server';
    const session = await auth();
    const file = formData.get('p12') as File | null;
    const passphrase = formData.get('passphrase')?.toString();
    if (!file || file.size === 0) throw new Error('Selecciona un archivo .p12');
    if (!passphrase) throw new Error('Falta la contraseña');
    if (file.size > 1_500_000) throw new Error('Archivo demasiado grande (>1.5 MB)');

    const bytes = Buffer.from(await file.arrayBuffer()).toString('base64');
    try {
      await uploadCertificate(session?.accessToken, { p12Base64: bytes, passphrase });
    } catch (err) {
      if (err instanceof ApiError) {
        throw new Error(`API ${err.status}: ${err.body || err.message}`);
      }
      throw err;
    }
    revalidatePath(RUTA);
  }

  async function revokeAction(formData: FormData) {
    'use server';
    const session = await auth();
    const reason = formData.get('reason')?.toString();
    if (!reason || reason.length < 3) throw new Error('Motivo demasiado corto');
    try {
      await revokeCertificate(session?.accessToken, reason);
    } catch (err) {
      if (err instanceof ApiError) {
        throw new Error(`API ${err.status}: ${err.body || err.message}`);
      }
      throw err;
    }
    revalidatePath(RUTA);
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">
          Aubergine · Facturación
        </p>
        <h1 className="text-3xl font-semibold text-aubergine-700">Certificado Verifactu</h1>
        <p className="text-sm text-aubergine-700/70">
          Certificado digital (PKCS#12) usado para firmar las facturas que se envían a la AEAT. El
          archivo se cifra en reposo (AES-256-GCM) y nunca se devuelve sin descifrar.
        </p>
      </header>

      {loadError && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {loadError}
        </div>
      )}

      {cert ? <CurrentCertificateCard cert={cert} revokeAction={revokeAction} /> : <EmptyState />}

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100">
        <h2 className="text-lg font-semibold text-aubergine-700">
          {cert ? 'Reemplazar certificado' : 'Subir certificado'}
        </h2>
        <p className="mt-1 text-sm text-aubergine-700/70">
          Selecciona el archivo .p12 emitido por tu Autoridad de Certificación (FNMT, Camerfirma,
          etc.) e introduce la contraseña. La contraseña no se guarda; sólo se usa para validar que
          el archivo se puede abrir y extraer los metadatos.
        </p>
        <form action={uploadAction} className="mt-4 space-y-4">
          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            Archivo .p12
            <input
              name="p12"
              type="file"
              accept=".p12,.pfx,application/x-pkcs12"
              required
              className="mt-1 block w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm text-aubergine-700 file:mr-3 file:rounded-md file:border-0 file:bg-aubergine-100 file:px-3 file:py-1 file:text-aubergine-700 hover:file:bg-aubergine-200"
            />
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-aubergine-500">
            Contraseña
            <input
              name="passphrase"
              type="password"
              required
              autoComplete="off"
              className="mt-1 block w-full max-w-sm rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-aubergine-700 px-4 py-2 text-sm font-medium text-white hover:bg-aubergine-900"
          >
            {cert ? 'Reemplazar certificado' : 'Subir certificado'}
          </button>
        </form>
      </section>
    </main>
  );
}

function EmptyState() {
  return (
    <section className="rounded-2xl border-2 border-dashed border-aubergine-200 bg-aubergine-50/40 p-8 text-center">
      <p className="text-sm font-medium text-aubergine-700">No hay certificado configurado</p>
      <p className="mt-1 text-xs text-aubergine-700/70">
        Sube un .p12 para poder firmar facturas y enviarlas a la AEAT.
      </p>
    </section>
  );
}

function CurrentCertificateCard({
  cert,
  revokeAction,
}: {
  cert: CertificateMetadata;
  revokeAction: (formData: FormData) => Promise<void>;
}) {
  const now = Date.now();
  const notAfter = new Date(cert.notAfter).getTime();
  const daysLeft = Math.floor((notAfter - now) / (24 * 3600 * 1000));
  const isExpired = daysLeft < 0;
  const isRevoked = cert.revokedAt !== null;

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-aubergine-100">
      {isRevoked && (
        <div className="bg-slate-800 px-6 py-2 text-xs font-medium uppercase tracking-wide text-white">
          Revocado · {new Date(cert.revokedAt!).toLocaleString('es-ES')}
        </div>
      )}
      {!isRevoked && isExpired && (
        <div className="bg-rose-600 px-6 py-2 text-xs font-medium uppercase tracking-wide text-white">
          Caducado hace {Math.abs(daysLeft)} días
        </div>
      )}
      <div className="grid gap-4 p-6 sm:grid-cols-2">
        <Field label="Sujeto" value={cert.subjectCn} mono />
        <Field label="Número de serie" value={cert.serialNumber} mono />
        <Field
          label="Validez"
          value={`${formatDate(cert.notBefore)} → ${formatDate(cert.notAfter)}`}
        />
        <Field
          label="Estado"
          value={
            isRevoked
              ? 'Revocado'
              : isExpired
                ? 'Caducado'
                : `Activo · ${daysLeft} día${daysLeft === 1 ? '' : 's'} restantes`
          }
          badge={expiryBadgeClass(isRevoked, isExpired, daysLeft)}
        />
        <div className="sm:col-span-2">
          <Field label="Huella SHA-256" value={cert.fingerprintSha256} mono small />
        </div>
        <Field
          label="Subido"
          value={`${formatDate(cert.uploadedAt)} (${new Date(cert.uploadedAt).toLocaleTimeString('es-ES')})`}
          small
        />
      </div>

      {!isRevoked && (
        <form
          action={revokeAction}
          className="border-t border-aubergine-100 bg-aubergine-50/40 p-6"
        >
          <h3 className="text-sm font-semibold text-aubergine-700">Revocar certificado</h3>
          <p className="mt-1 text-xs text-aubergine-700/70">
            Marca el certificado como revocado. Las facturas dejarán de poder firmarse hasta que
            subas uno nuevo. Esta acción no borra el archivo cifrado del disco.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-aubergine-500">
              Motivo
              <input
                name="reason"
                type="text"
                required
                minLength={3}
                placeholder="Ej. comprometido, sustituido, expirado"
                className="mt-1 block w-72 rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-medium text-white hover:bg-rose-800"
            >
              Revocar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  mono,
  small,
  badge,
}: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
  badge?: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-aubergine-500">{label}</p>
      {badge ? (
        <span
          className={`mt-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge}`}
        >
          {value}
        </span>
      ) : (
        <p
          className={`mt-1 text-aubergine-700 ${mono ? 'font-mono' : ''} ${
            small ? 'text-xs break-all' : 'text-sm'
          }`}
        >
          {value}
        </p>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function expiryBadgeClass(revoked: boolean, expired: boolean, daysLeft: number): string {
  if (revoked) return 'bg-slate-800 text-white';
  if (expired) return 'bg-rose-100 text-rose-800';
  if (daysLeft < 30) return 'bg-rose-100 text-rose-800';
  if (daysLeft < 90) return 'bg-amber-100 text-amber-800';
  return 'bg-emerald-100 text-emerald-800';
}
