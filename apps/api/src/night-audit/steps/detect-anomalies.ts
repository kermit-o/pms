import { Logger } from '@nestjs/common';
import { NightAuditStep } from '@pms/db';
import type { AnomalyMetrics } from '../anomaly.metrics';
import type { AnomalyService } from '../anomaly.service';
import type { StepContext, StepResult, StepRunner } from '../step';

/**
 * Paso DETECT_ANOMALIES (Sprint 6 W2).
 *
 * Corre entre SNAPSHOT_REPORTS y CLOSE_DAY. Recolecta señales con
 * AnomalyService.detectAll, las persiste en night_audit_anomalies y
 * emite counters Prometheus. Nunca bloquea el cierre — solo registra.
 *
 * Idempotencia: si el step se re-ejecuta para el mismo run_id, primero
 * borra las anomalias previas del run (no del business_date, porque otro
 * run del mismo dia las habria escrito). Asi un retry queda limpio sin
 * tocar señales de runs ajenos.
 */
export class DetectAnomaliesStep implements StepRunner {
  readonly step = NightAuditStep.DETECT_ANOMALIES;
  private readonly log = new Logger('DetectAnomaliesStep');

  constructor(
    private readonly anomaly: AnomalyService,
    private readonly metrics: AnomalyMetrics,
  ) {}

  async run(ctx: StepContext): Promise<StepResult> {
    // Limpia señales previas del MISMO run (retry-safe).
    await ctx.tx.nightAuditAnomaly.deleteMany({ where: { runId: ctx.runId } });

    const detected = await this.anomaly.detectAll(ctx);

    if (detected.length === 0) {
      return { totals: { anomalies: 0 } };
    }

    await ctx.tx.nightAuditAnomaly.createMany({
      data: detected.map((a) => ({
        tenantId: ctx.user.tenantId,
        propertyId: ctx.propertyId,
        runId: ctx.runId,
        businessDate: ctx.businessDateAsDate,
        kind: a.kind,
        severity: a.severity,
        details: a.details,
      })),
    });

    // Counters: una incrementacion por anomalia detectada.
    for (const a of detected) {
      this.metrics.anomalies.add(1, {
        tenant: ctx.user.tenantId,
        property: ctx.propertyId,
        kind: a.kind,
        severity: a.severity,
      });
    }

    const breakdown: Record<string, number> = {};
    for (const a of detected) {
      const k = `${a.kind}:${a.severity}`;
      breakdown[k] = (breakdown[k] ?? 0) + 1;
    }
    this.log.warn(
      `tenant=${ctx.user.tenantId} prop=${ctx.propertyId} date=${ctx.businessDate} detected=${detected.length} ${JSON.stringify(breakdown)}`,
    );

    return {
      result: { count: detected.length, breakdown },
      totals: { anomalies: detected.length },
    };
  }
}
