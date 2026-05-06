import type { NightAuditStep, Prisma } from '@pms/db';
import type { AuthUser } from '../auth';

/**
 * Context handed to every step.
 *
 * `tx` is the Prisma client already wrapped in withTenant() when the
 * orchestrator opened the transaction; steps must use it (not the raw
 * PrismaService) so RLS + audit settings stay consistent.
 */
export interface StepContext {
  tx: Prisma.TransactionClient;
  user: AuthUser;
  correlationId: string;
  runId: string;
  propertyId: string;
  /** YYYY-MM-DD string of the business date being audited. */
  businessDate: string;
  /** Same date as a Date object at midnight UTC for Prisma queries. */
  businessDateAsDate: Date;
}

export interface StepResult {
  /** Free-form structured result persisted on `night_audit_run_steps.result`. */
  result?: unknown;
  /** Counters that the orchestrator merges into NightAuditRun.totals. */
  totals?: Record<string, number | string>;
}

export interface StepRunner {
  readonly step: NightAuditStep;
  run(ctx: StepContext): Promise<StepResult>;
}
