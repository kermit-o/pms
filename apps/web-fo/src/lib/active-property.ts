import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { listProperties, type PropertySummary } from './api';

const COOKIE = 'pms_active_property';

/**
 * Devuelve la property activa del operador. Estrategia:
 *  1. Cookie 'pms_active_property' (seteada por el selector del nav)
 *  2. Primera property del tenant (orden alfabético por code)
 *  3. null si la API no devuelve ninguna o no hay sesión
 *
 * Cachea en la cookie tras el primer fetch para que las siguientes
 * navegaciones no llamen al endpoint.
 */
export async function getActiveProperty(): Promise<PropertySummary | null> {
  const session = await auth();
  if (!session?.accessToken) return null;

  const all = await listProperties(session.accessToken);
  if (all.length === 0) return null;

  const jar = await cookies();
  const cookieId = jar.get(COOKIE)?.value;
  const fromCookie = cookieId ? all.find((p) => p.id === cookieId) : undefined;
  return fromCookie ?? all[0] ?? null;
}

export async function getActivePropertyId(): Promise<string | null> {
  const p = await getActiveProperty();
  return p?.id ?? null;
}

export const ACTIVE_PROPERTY_COOKIE = COOKIE;
