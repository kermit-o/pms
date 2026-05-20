import { Logger } from '@nestjs/common';
import { NightAuditStep } from '@pms/db';
import type { StepContext, StepResult, StepRunner } from '../step';

const log = new Logger('CleanupOrphanTenantsStep');

/**
 * Sprint 10 W3 — Limpieza nocturna de tenants huérfanos del onboarding
 * self-service (S9 W3).
 *
 * Un tenant queda huérfano cuando alguien hace `verify` (que crea el
 * tenant con slug `pending-<hash>` y `onboarding_status='EMAIL_VERIFIED'`)
 * y nunca completa el `setup`. Si pasan más de 7 días, asumimos que el
 * usuario abandonó.
 *
 * El paso es **idempotente**: hace un soft-delete (`deleted_at = NOW()`)
 * sobre tenants que matchean los tres criterios:
 *   - onboarding_status = 'EMAIL_VERIFIED'
 *   - slug LIKE 'pending-%'
 *   - created_at < NOW() - 7d
 *   - deleted_at IS NULL  (ya marcado en intentos previos)
 *
 * La tabla `tenants` no tiene RLS (admin-level), así que el `ctx.tx`
 * puede tocar registros de otros tenants — eso es justo lo que queremos
 * para una limpieza global.
 *
 * El pipeline de NA corre **por property**: si hay N hoteles cerrando
 * la noche, este paso se ejecuta N veces. El primero borra, los demás
 * encuentran 0 filas. Idempotente.
 *
 * Configurable via `ORPHAN_TENANT_TTL_DAYS` (default 7). 0 desactiva
 * el paso (devuelve `{ deleted: 0, skipped: true }`).
 */
export class CleanupOrphanTenantsStep implements StepRunner {
  readonly step = NightAuditStep.CLEANUP_ORPHAN_TENANTS;

  constructor(private readonly ttlDays: number = 7) {}

  async run(ctx: StepContext): Promise<StepResult> {
    if (this.ttlDays <= 0) {
      return { totals: { deletedOrphanTenants: 0 }, result: { skipped: true } };
    }

    const cutoff = new Date(Date.now() - this.ttlDays * 86_400_000);

    const out = await ctx.tx.tenant.updateMany({
      where: {
        onboardingStatus: 'EMAIL_VERIFIED',
        slug: { startsWith: 'pending-' },
        createdAt: { lt: cutoff },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    if (out.count > 0) {
      log.log(`soft-deleted ${out.count} orphan tenant(s) older than ${this.ttlDays}d`);
    }

    return {
      result: { deleted: out.count, ttlDays: this.ttlDays, cutoff: cutoff.toISOString() },
      totals: { deletedOrphanTenants: out.count },
    };
  }
}
