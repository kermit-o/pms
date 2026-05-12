import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { listProperties } from '@/lib/api';
import { ACTIVE_PROPERTY_COOKIE } from '@/lib/active-property';

/**
 * Selector compacto de property que vive en el nav. Setea cookie HttpOnly
 * para que el server-side la lea en la próxima request. Si el tenant solo
 * tiene 1 property, muestra el nombre sin selector (caso piloto MVP).
 */
export default async function PropertyPicker() {
  const session = await auth();
  if (!session?.accessToken) return null;

  const all = await listProperties(session.accessToken);
  if (all.length === 0) return null;

  const first = all[0];
  if (!first) return null;
  const jar = await cookies();
  const activeId = jar.get(ACTIVE_PROPERTY_COOKIE)?.value ?? first.id;
  const active = all.find((p) => p.id === activeId) ?? first;

  if (all.length === 1) {
    return (
      <span className="rounded-md bg-aubergine-50 px-2.5 py-1.5 text-xs font-medium text-aubergine-700">
        {active.code}
      </span>
    );
  }

  async function setActive(formData: FormData) {
    'use server';
    const id = formData.get('propertyId')?.toString();
    if (!id) return;
    const j = await cookies();
    j.set(ACTIVE_PROPERTY_COOKIE, id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
    });
    revalidatePath('/', 'layout');
  }

  return (
    <form action={setActive} className="flex items-center gap-2">
      <select
        name="propertyId"
        defaultValue={active.id}
        className="rounded-md border border-aubergine-100 bg-white px-2 py-1 text-xs"
      >
        {all.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} · {p.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-md bg-aubergine-700 px-2 py-1 text-xs font-medium text-white"
      >
        Cambiar
      </button>
    </form>
  );
}
