import { Logger } from '@nestjs/common';
import { BusinessDayStatus, NightAuditStep, Prisma } from '@pms/db';
import type { StepContext, StepResult, StepRunner } from '../step';

const log = new Logger('CloseDayStep');

/**
 * Final step: marks the business day CLOSED.
 *
 * Pre-flight gate: there must be a cash_drawer_reconciliations row for
 * (property, businessDate) with `|discrepancy * 100| <= toleranceCents`.
 * The tolerance defaults to 0 cents but is configurable per row (and per
 * property in a follow-up). Failing this check throws an error and the
 * orchestrator records the step as FAILED — operators reanude after the
 * count is corrected.
 *
 * The CLOSE_DAY transition itself is idempotent: if the day is already
 * CLOSED we update `closed_by_user_id` + `closed_at` to the current
 * operator (audit trail of who actually finished the run) but otherwise
 * leave the row alone.
 */
export class CloseDayStep implements StepRunner {
  readonly step = NightAuditStep.CLOSE_DAY;

  async run(ctx: StepContext): Promise<StepResult> {
    const reconciliation = await ctx.tx.cashDrawerReconciliation.findFirst({
      where: {
        propertyId: ctx.propertyId,
        businessDate: ctx.businessDateAsDate,
      },
    });

    if (!reconciliation) {
      throw new Error(
        `Cash reconciliation missing for ${ctx.businessDate}. Conta la caja antes de cerrar el día.`,
      );
    }

    const discrepancyCents = new Prisma.Decimal(reconciliation.discrepancy).times(100).toNumber();
    if (Math.abs(discrepancyCents) > reconciliation.toleranceCents) {
      throw new Error(
        `Cash discrepancy ${reconciliation.discrepancy.toString()} ${reconciliation.currency} exceeds tolerance ${reconciliation.toleranceCents} cents`,
      );
    }

    const closedAt = new Date();
    const existing = await ctx.tx.businessDayState.findFirst({
      where: {
        propertyId: ctx.propertyId,
        businessDate: ctx.businessDateAsDate,
      },
      select: { status: true },
    });

    if (existing) {
      await ctx.tx.businessDayState.update({
        where: {
          propertyId_businessDate: {
            propertyId: ctx.propertyId,
            businessDate: ctx.businessDateAsDate,
          },
        },
        data: {
          status: BusinessDayStatus.CLOSED,
          closedAt,
          closedByUserId: ctx.user.sub,
          reopenedAt: null,
          reopenedReason: null,
        },
      });
    } else {
      await ctx.tx.businessDayState.create({
        data: {
          tenantId: ctx.user.tenantId,
          propertyId: ctx.propertyId,
          businessDate: ctx.businessDateAsDate,
          status: BusinessDayStatus.CLOSED,
          closedAt,
          closedByUserId: ctx.user.sub,
        },
      });
    }

    log.log(`day ${ctx.businessDate} closed by ${ctx.user.sub}`);

    return {
      result: {
        businessDate: ctx.businessDate,
        closedAt: closedAt.toISOString(),
        cashReconciliation: {
          expected: reconciliation.expectedAmount.toString(),
          counted: reconciliation.countedAmount.toString(),
          discrepancy: reconciliation.discrepancy.toString(),
        },
      },
    };
  }
}
