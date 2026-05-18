/**
 * Site key Turnstile expuesto al cliente (Sprint 9 W4).
 *
 * Cloudflare Turnstile separa "site key" (público, va en el script del
 * navegador) y "secret key" (queda en el API). Aquí solo manejamos el
 * primero. Si no está, el componente <Turnstile/> no monta — el API hace
 * skip si también le falta TURNSTILE_SECRET_KEY.
 *
 * Next.js requiere prefijo `NEXT_PUBLIC_` para que el valor llegue al
 * bundle del cliente.
 */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
