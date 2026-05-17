import { Injectable, Logger } from '@nestjs/common';
import {
  NightAuditAnomalyKind,
  NightAuditAnomalySeverity,
  Prisma,
} from '@pms/db';
import type { StepContext } from './step';

/**
 * Anomaly detection rules V1 (Sprint 6 W2). Cada metodo consulta el estado
 * del business_date y devuelve cero o mas anomalias detectadas. El step
 * runner las persiste en `night_audit_anomalies` en una sola transaccion.
 *
 * Principios:
 *  - Solo señales. Nada se auto-corrige (ADR-020). El supervisor decide.
 *  - SQL puro contra Prisma — sin modelos estadisticos en V1.
 *  - Idempotencia: re-ejecutar el step en el mismo dia produce las mismas
 *    anomalias (las del run anterior siguen ahi). Para no duplicar entre
 *    runs del MISMO dia, el step runner filtra antes de insertar.
 *
 * Reglas V1:
 *  - DUPLICATE_CHARGE  : misma idempotency_key con descripcion/amount distintos
 *  - CASH_DRAWER_VARIANCE : |discrepancy| / expected > 5%
 *  - DEEP_DISCOUNT     : DISCOUNT >= 50% del CHARGE del mismo folio del dia
 *  - CANCELLATION_SPREE: mismo guest_id con > 3 cancellations same-day
 *
 * RATE_OVERRIDE (z-score) deferido a V2 — no hay BAR baseline diario.
 */
@Injectable()
export class AnomalyService {
  private readonly log = new Logger(AnomalyService.name);

  async detectAll(ctx: StepContext): Promise<DetectedAnomaly[]> {
    const out: DetectedAnomaly[] = [];
    const tasks: Array<Promise<DetectedAnomaly[]>> = [
      this.detectDuplicateCharges(ctx),
      this.detectCashDrawerVariance(ctx),
      this.detectDeepDiscounts(ctx),
      this.detectCancellationSpree(ctx),
    ];
    const settled = await Promise.allSettled(tasks);
    for (const r of settled) {
      if (r.status === 'fulfilled') out.push(...r.value);
      else this.log.warn(`anomaly rule failed: ${(r.reason as Error).message}`);
    }
    return out;
  }

  /**
   * DUPLICATE_CHARGE — critical. Misma idempotency_key con resultado distinto.
   * El unique constraint (folio_id, idempotency_key) lo evita en el camino
   * normal, pero puede pasar si distintos clientes mandan distinto payload
   * con la misma key en folios distintos del mismo dia. Aqui levantamos la
   * señal para que el operador revise.
   *
   * Detectamos: idempotency_key con >1 row en el dia con amount diferente.
   */
  private async detectDuplicateCharges(ctx: StepContext): Promise<DetectedAnomaly[]> {
    const start = startOfDay(ctx.businessDateAsDate);
    const end = endOfDay(ctx.businessDateAsDate);
    const rows = await ctx.tx.$queryRaw<
      Array<{ idempotency_key: string; rows: number; amounts: string }>
    >`
      SELECT
        idempotency_key,
        COUNT(*)::int AS rows,
        STRING_AGG(DISTINCT amount::text, ',' ORDER BY amount::text) AS amounts
      FROM folio_entries
      WHERE tenant_id = ${ctx.user.tenantId}::uuid
        AND idempotency_key IS NOT NULL
        AND posted_at >= ${start}
        AND posted_at <  ${end}
      GROUP BY idempotency_key
      HAVING COUNT(*) > 1
         AND COUNT(DISTINCT amount) > 1
    `;
    return rows.map((r) => ({
      kind: NightAuditAnomalyKind.DUPLICATE_CHARGE,
      severity: NightAuditAnomalySeverity.CRITICAL,
      details: {
        idempotencyKey: r.idempotency_key,
        rows: r.rows,
        amounts: r.amounts,
      },
    }));
  }

  /**
   * CASH_DRAWER_VARIANCE — high. |discrepancy| / expected > 5%.
   */
  private async detectCashDrawerVariance(ctx: StepContext): Promise<DetectedAnomaly[]> {
    const recon = await ctx.tx.cashDrawerReconciliation.findUnique({
      where: {
        propertyId_businessDate: {
          propertyId: ctx.propertyId,
          businessDate: ctx.businessDateAsDate,
        },
      },
    });
    if (!recon) return [];
    const expected = Number(recon.expectedAmount);
    const discrepancy = Number(recon.discrepancy);
    if (expected <= 0) return [];
    const ratio = Math.abs(discrepancy) / expected;
    if (ratio <= 0.05) return [];
    return [
      {
        kind: NightAuditAnomalyKind.CASH_DRAWER_VARIANCE,
        severity: NightAuditAnomalySeverity.HIGH,
        details: {
          expectedAmount: expected,
          countedAmount: Number(recon.countedAmount),
          discrepancy,
          variancePct: Math.round(ratio * 10000) / 100,
          currency: recon.currency,
        },
      },
    ];
  }

  /**
   * DEEP_DISCOUNT — medium. Folio con DISCOUNT cuyo |amount| >= 50% de la
   * suma de CHARGE del mismo folio en el business day. Pista de comp/houseuse
   * abusivo o error de operador.
   */
  private async detectDeepDiscounts(ctx: StepContext): Promise<DetectedAnomaly[]> {
    const start = startOfDay(ctx.businessDateAsDate);
    const end = endOfDay(ctx.businessDateAsDate);
    const rows = await ctx.tx.$queryRaw<
      Array<{ folio_id: string; charges: string; discounts: string }>
    >`
      WITH day AS (
        SELECT
          folio_id,
          SUM(CASE WHEN type = 'CHARGE'   THEN amount ELSE 0 END) AS charges,
          SUM(CASE WHEN type = 'DISCOUNT' THEN ABS(amount) ELSE 0 END) AS discounts
        FROM folio_entries
        WHERE tenant_id = ${ctx.user.tenantId}::uuid
          AND posted_at >= ${start}
          AND posted_at <  ${end}
        GROUP BY folio_id
      )
      SELECT folio_id::text, charges::text, discounts::text
      FROM day
      WHERE charges > 0
        AND discounts >= charges * 0.5
    `;
    return rows.map((r) => ({
      kind: NightAuditAnomalyKind.DEEP_DISCOUNT,
      severity: NightAuditAnomalySeverity.MEDIUM,
      details: {
        folioId: r.folio_id,
        chargesTotal: Number(r.charges),
        discountsTotal: Number(r.discounts),
        discountPct: Math.round((Number(r.discounts) / Number(r.charges)) * 10000) / 100,
      },
    }));
  }

  /**
   * CANCELLATION_SPREE — medium. Mismo guest con >3 reservas canceladas el
   * mismo dia. Posible fraude o test del operador.
   */
  private async detectCancellationSpree(ctx: StepContext): Promise<DetectedAnomaly[]> {
    const start = startOfDay(ctx.businessDateAsDate);
    const end = endOfDay(ctx.businessDateAsDate);
    const rows = await ctx.tx.$queryRaw<
      Array<{ guest_id: string; cancellations: number }>
    >`
      SELECT
        rg.guest_id::text,
        COUNT(*)::int AS cancellations
      FROM reservations r
      JOIN reservation_guests rg ON rg.reservation_id = r.id
      WHERE r.tenant_id = ${ctx.user.tenantId}::uuid
        AND r.property_id = ${ctx.propertyId}::uuid
        AND r.cancelled_at IS NOT NULL
        AND r.cancelled_at >= ${start}
        AND r.cancelled_at <  ${end}
        AND rg.is_primary = TRUE
      GROUP BY rg.guest_id
      HAVING COUNT(*) > 3
    `;
    return rows.map((r) => ({
      kind: NightAuditAnomalyKind.CANCELLATION_SPREE,
      severity: NightAuditAnomalySeverity.MEDIUM,
      details: {
        guestId: r.guest_id,
        cancellationsCount: r.cancellations,
      },
    }));
  }
}

export interface DetectedAnomaly {
  kind: NightAuditAnomalyKind;
  severity: NightAuditAnomalySeverity;
  details: Prisma.InputJsonValue;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}
function endOfDay(d: Date): Date {
  const out = startOfDay(d);
  out.setUTCDate(out.getUTCDate() + 1);
  return out;
}
