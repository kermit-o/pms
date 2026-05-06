import { Logger } from '@nestjs/common';
import { BusinessDayStatus, NightAuditStep } from '@pms/db';
import type { StepContext, StepResult, StepRunner } from '../step';

const log = new Logger('CloseDayStep');

/**
 * Final step: marks the business day CLOSED.
 *
 * Idempotent: if the day is already CLOSED we update the closed_by_user_id
 * + closed_at to the current operator (audit trail of who actually finished
 * the run) but otherwise leave the row alone.
 */
export class CloseDayStep implements StepRunner {
  readonly step = NightAuditStep.CLOSE_DAY;

  async run(ctx: StepContext): Promise<StepResult> {
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
      result: { businessDate: ctx.businessDate, closedAt: closedAt.toISOString() },
    };
  }
}
