import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  APP_HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  REDIS_URL: z.string().url(),
  NATS_URL: z.string().url(),

  KEYCLOAK_URL: z.string().url(),
  KEYCLOAK_REALM: z.string().min(1),
  KEYCLOAK_CLIENT_ID: z.string().min(1),

  // Secret HMAC para pairing tokens (login QR HSK). Si no se setea, en dev
  // se autogenera (proceso) y en prod la API se niega a arrancar — los
  // tokens emitidos por una replica no serian validos en otra.
  PAIRING_SECRET: z.string().min(32).optional(),
  PAIRING_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  PAIRING_CODE_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(120),

  // Object storage para fotos de Lost & Found. Driver 'inline' (default)
  // mantiene base64 en DB — comodo en dev y cuando no hay S3 configurado.
  // Driver 's3' sube a un bucket S3-compatible (Backblaze B2, Cloudflare R2,
  // MinIO) y guarda la URL firmada. Las URLs caducan tras
  // PHOTO_STORAGE_SIGNED_URL_TTL_SECONDS.
  PHOTO_STORAGE_DRIVER: z.enum(['inline', 's3']).default('inline'),
  PHOTO_STORAGE_BUCKET: z.string().optional(),
  PHOTO_STORAGE_REGION: z.string().default('eu-central-003'),
  PHOTO_STORAGE_ENDPOINT: z.string().url().optional(),
  PHOTO_STORAGE_ACCESS_KEY_ID: z.string().optional(),
  PHOTO_STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  PHOTO_STORAGE_PUBLIC_URL_PREFIX: z.string().url().optional(),
  PHOTO_STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(7 * 24 * 3600)
    .default(3600),

  ANTHROPIC_API_KEY: z.string().optional(),
  // Sprint 6 W1. Driver del copilot — 'anthropic' usa el SDK real, 'stub'
  // el matcher deterministico (tests + demos sin API key). Si no se
  // setea, el service hace fallback a stub cuando ANTHROPIC_API_KEY falta.
  COPILOT_DRIVER: z.enum(['anthropic', 'stub']).optional(),
  COPILOT_MODEL: z.string().optional(),

  // Stripe — pagos y tokenizacion de tarjeta (garantia CARD_ON_FILE).
  // En test/dev: usa sk_test_... + whsec_test_... y la web usa pk_test_...
  // En prod: claves live correspondientes. Si no se setean, los endpoints
  // de payments responden 503; el operador sigue pudiendo marcar garantia
  // manual con ultimos 4.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // SES.HOSPEDAJES (Guardia Civil). En staging apunta a sandbox; en prod
  // al endpoint real. Si no se configura, los envios se quedan en QUEUED
  // y el envio real es no-op (util en tests/dev).
  SES_HOSPEDAJES_ENDPOINT: z.string().url().optional(),
  SES_HOSPEDAJES_API_KEY: z.string().optional(),

  // Notifications (Sprint 9 W1). Si POSTMARK_SERVER_TOKEN está, el
  // provider envía emails reales; sin él, el module entra en modo
  // dry-run (loguea estructurado y no toca la red). NOTIFICATIONS_FROM
  // es la dirección remitente verificada en Postmark/SMTP.
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  NOTIFICATIONS_FROM: z.string().email().optional(),
  NOTIFICATIONS_REPLY_TO: z.string().email().optional(),
  /** Base URL del IBE público (para los enlaces "Gestionar mi reserva" en emails). */
  IBE_PUBLIC_URL: z.string().url().optional(),
  /** Base URL del back-office (para los enlaces "Abrir en back-office" en emails al hotel). */
  BACKOFFICE_PUBLIC_URL: z.string().url().optional(),

  // Anti-abuso (Sprint 9 W4). Si TURNSTILE_SECRET_KEY está, el API verifica
  // el token cf-turnstile que envía el IBE en POSTs de mutación. Si falta,
  // el guard hace skip (útil en dev y para hoteles sin tráfico adverso).
  TURNSTILE_SECRET_KEY: z.string().optional(),
  // Onboarding wizard (Sprint 9 W3). Secret HMAC para firmar los tokens
  // de verificación email + setup. En prod la API se niega a arrancar sin
  // este secret; en dev se auto-genera (proceso) si falta.
  ONBOARDING_SECRET: z.string().min(32).optional(),
  ONBOARDING_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(24),
  // Channel manager (Sprint 9 W2). Sin estos vars todo es no-op.
  // CM_SITEMINDER_API_BASE: endpoint REST del provider.
  // CM_SITEMINDER_HMAC_SECRET: shared secret para verificar webhooks.
  CM_SITEMINDER_API_BASE: z.string().url().optional(),
  CM_SITEMINDER_HMAC_SECRET: z.string().optional(),

  // Observability (OpenTelemetry). Las leen tracing.ts antes que NestJS.
  OTEL_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .default('true')
    .transform((v) => v === 'true'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_METRICS_PORT: z.coerce.number().int().positive().default(9464),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${formatted}`);
  }
  return parsed.data;
}
