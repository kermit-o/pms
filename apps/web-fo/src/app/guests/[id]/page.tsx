import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { ApiError, eraseGuest, getGuest, patchGuest } from '@/lib/api';
import type { GuestDetail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function GuestDetailPage({ params }: { params: { id: string } }) {
  const session = await auth();
  const guestId = params.id;

  let guest: GuestDetail | null = null;
  let error: string | null = null;
  try {
    guest = await getGuest(session?.accessToken, guestId);
  } catch (err) {
    error = err instanceof ApiError ? `API ${err.status}: ${err.body}` : (err as Error).message;
  }

  async function update(formData: FormData) {
    'use server';
    const session = await auth();
    const input = {
      firstName: stringOrUndef(formData.get('firstName')),
      lastName: stringOrUndef(formData.get('lastName')),
      email: stringOrUndef(formData.get('email')),
      phone: stringOrUndef(formData.get('phone')),
      nationality: stringOrUndef(formData.get('nationality')),
      documentType: stringOrUndef(formData.get('documentType')) as
        | 'DNI'
        | 'NIE'
        | 'PASSPORT'
        | 'EU_ID'
        | 'OTHER'
        | undefined,
      documentNumber: stringOrUndef(formData.get('documentNumber')),
      addressLine1: stringOrUndef(formData.get('addressLine1')),
      city: stringOrUndef(formData.get('city')),
      postalCode: stringOrUndef(formData.get('postalCode')),
      country: stringOrUndef(formData.get('country')),
      gdprConsent: formData.get('gdprConsent') === 'on',
      marketingConsent: formData.get('marketingConsent') === 'on',
      notes: stringOrUndef(formData.get('notes')),
    };
    await patchGuest(session?.accessToken, guestId, input);
    revalidatePath(`/guests/${guestId}`);
  }

  async function erase(formData: FormData) {
    'use server';
    const session = await auth();
    const reason = formData.get('reason')?.toString().trim();
    const hard = formData.get('hard') === 'on';
    if (!reason) throw new Error('Motivo obligatorio');
    await eraseGuest(session?.accessToken, guestId, reason, hard);
    if (hard) redirect('/guests');
    revalidatePath(`/guests/${guestId}`);
  }

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/guests" className="text-sm text-aubergine-500 hover:underline">
          ← Volver a huéspedes
        </Link>
        <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-100">
          {error}
        </div>
      </main>
    );
  }
  if (!guest) return null;

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <Link href="/guests" className="text-sm text-aubergine-500 hover:underline">
        ← Volver a huéspedes
      </Link>

      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-aubergine-500">Aubergine · Cardex</p>
        <h1 className="text-3xl font-semibold text-aubergine-700">
          {guest.lastName}, {guest.firstName}
        </h1>
        <p className="text-sm text-aubergine-700/70">
          GDPR consent: {guest.gdprConsent ? 'sí' : 'no'} · Marketing:{' '}
          {guest.marketingConsent ? 'sí' : 'no'}
        </p>
      </header>

      <form
        action={update}
        className="space-y-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100"
      >
        <Section title="Identificación">
          <Field label="Nombre" name="firstName" defaultValue={guest.firstName} required />
          <Field label="Apellidos" name="lastName" defaultValue={guest.lastName} required />
          <Field label="Email" name="email" type="email" defaultValue={guest.email ?? ''} />
          <Field label="Teléfono" name="phone" defaultValue={guest.phone ?? ''} />
          <Field
            label="Nacionalidad (ISO-2)"
            name="nationality"
            defaultValue={guest.nationality ?? ''}
            maxLength={2}
          />
        </Section>

        <Section title="Documento (cardex / SES.HOSPEDAJES)">
          <Select label="Tipo" name="documentType" defaultValue={guest.documentType ?? ''}>
            <option value="">—</option>
            <option value="DNI">DNI</option>
            <option value="NIE">NIE</option>
            <option value="PASSPORT">Passport</option>
            <option value="EU_ID">EU ID</option>
            <option value="OTHER">Otro</option>
          </Select>
          <Field label="Número" name="documentNumber" defaultValue={guest.documentNumber ?? ''} />
        </Section>

        <Section title="Dirección">
          <Field label="Línea 1" name="addressLine1" defaultValue={guest.addressLine1 ?? ''} />
          <Field label="Ciudad" name="city" defaultValue={guest.city ?? ''} />
          <Field label="Código postal" name="postalCode" defaultValue={guest.postalCode ?? ''} />
          <Field
            label="País (ISO-2)"
            name="country"
            defaultValue={guest.country ?? ''}
            maxLength={2}
          />
        </Section>

        <Section title="Consentimientos">
          <Checkbox label="GDPR consent" name="gdprConsent" defaultChecked={guest.gdprConsent} />
          <Checkbox
            label="Marketing consent"
            name="marketingConsent"
            defaultChecked={guest.marketingConsent}
          />
        </Section>

        <div>
          <label className="block text-sm font-medium text-aubergine-700">Notas</label>
          <textarea
            name="notes"
            rows={3}
            defaultValue={guest.notes ?? ''}
            className="mt-1 w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-lg bg-aubergine-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-aubergine-700"
          >
            Guardar cambios
          </button>
        </div>
      </form>

      <section className="space-y-3 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-aubergine-100">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-aubergine-500">GDPR</h2>
        <p className="text-xs text-aubergine-700/70">
          Derechos del titular bajo el RGPD. Las acciones quedan en el audit log; los registros
          financieros (folio) se preservan por la normativa fiscal española aunque los datos
          personales se borren.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/guests/${guest.id}/access-export`}
            className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-aubergine-700 ring-1 ring-aubergine-100 hover:bg-aubergine-50"
          >
            Descargar copia (acceso)
          </a>
        </div>
        <form action={erase} className="space-y-2 border-t border-aubergine-100 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-700">Borrado</h3>
          <Field label="Motivo" name="reason" required />
          <Checkbox label="Borrado duro (sólo admin, retención cumplida)" name="hard" />
          <button
            type="submit"
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700"
          >
            Anonimizar / borrar
          </button>
        </form>
      </section>
    </main>
  );
}

function stringOrUndef(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? undefined : trimmed;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold uppercase tracking-wide text-aubergine-500">
        {title}
      </legend>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({
  label,
  name,
  type = 'text',
  required,
  defaultValue,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  maxLength?: number;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-aubergine-700">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        maxLength={maxLength}
        className="mt-1 w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
      />
    </label>
  );
}

function Select({
  name,
  label,
  defaultValue,
  children,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-aubergine-700">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-aubergine-100 bg-white px-3 py-2 text-sm focus:border-aubergine-500 focus:outline-none focus:ring-1 focus:ring-aubergine-500"
      >
        {children}
      </select>
    </label>
  );
}

function Checkbox({
  label,
  name,
  defaultChecked,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-aubergine-700">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-aubergine-200 text-aubergine-600 focus:ring-aubergine-500"
      />
      {label}
    </label>
  );
}
