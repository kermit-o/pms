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

  ANTHROPIC_API_KEY: z.string().optional(),

  // SES.HOSPEDAJES (Guardia Civil). En staging apunta a sandbox; en prod
  // al endpoint real. Si no se configura, los envios se quedan en QUEUED
  // y el envio real es no-op (util en tests/dev).
  SES_HOSPEDAJES_ENDPOINT: z.string().url().optional(),
  SES_HOSPEDAJES_API_KEY: z.string().optional(),

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
