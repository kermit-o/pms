import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Datos que el API setea en cada request y que viajan hacia la DB como
 * settings de sesion para que los consuman las policies RLS y el trigger
 * de audit.
 */
export interface TenantContext {
  tenantId: string;
  actorId?: string | null;
  correlationId?: string | null;
}

/**
 * Cliente Prisma "scoped" a una transaccion. Es el que recibe el callback
 * dentro de withTenant — incluye los modelos pero no las APIs de control de
 * conexion ($connect, $disconnect, $transaction, etc).
 */
export type TenantPrismaClient = Prisma.TransactionClient;

/**
 * Ejecuta `fn` dentro de una transaccion Postgres con los settings
 * `app.tenant_id` (y opcionalmente `app.actor_id`, `app.correlation_id`)
 * inyectados como parametros LOCALES de sesion.
 *
 * Las policies RLS (ver migration.sql) los leen via current_setting().
 * El trigger de audit los lee tambien para registrar quien cambio que.
 *
 * Patron de uso desde el API:
 *
 *     await prisma.withTenant({ tenantId, actorId, correlationId }, async (tx) => {
 *       return tx.property.findMany();
 *     });
 *
 * Nota: usamos set_config(name, value, is_local=true) que es la version
 * parametrizable de SET LOCAL (evita SQL injection).
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  ctx: TenantContext,
  fn: (tx: TenantPrismaClient) => Promise<T>,
): Promise<T> {
  if (!ctx.tenantId) {
    throw new Error('withTenant requires a tenantId');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`;

    if (ctx.actorId) {
      await tx.$executeRaw`SELECT set_config('app.actor_id', ${ctx.actorId}, true)`;
    }
    if (ctx.correlationId) {
      await tx.$executeRaw`SELECT set_config('app.correlation_id', ${ctx.correlationId}, true)`;
    }

    return fn(tx);
  });
}
