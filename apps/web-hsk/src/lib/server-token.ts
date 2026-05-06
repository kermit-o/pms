import { cookies } from 'next/headers';
import { auth } from '@/auth';

export const PAIRING_COOKIE = 'aubergine_pairing';

/**
 * Devuelve el bearer token a usar contra la API. Camareras emparejadas
 * (login QR) llevan un JWT HMAC en una cookie HttpOnly; el resto pasa por
 * Keycloak via next-auth. La cookie tiene prioridad: una camarera que
 * cierre sesion Keycloak pero conserve su pairing sigue funcionando.
 */
export async function getApiToken(): Promise<string | undefined> {
  const jar = await cookies();
  const paired = jar.get(PAIRING_COOKIE)?.value;
  if (paired) return paired;
  const session = await auth();
  return session?.accessToken;
}
