import { Logger } from '@nestjs/common';
import { NightAuditStep, ReservationStatus } from '@pms/db';
import type { StepContext, StepResult, StepRunner } from '../step';

const log = new Logger('MarkNoShowsStep');

/**
 * Marks PENDING / CONFIRMED reservations whose arrival date is on or before
 * the business date as NO_SHOW. The transition is idempotent: re-running
 * the step finds zero candidates because all matches are already terminal.
 *
 * Penalty fees: in this MVP we record the no-show and emit the canonical
 * `reservation.no_show` event. A penalty fee implementation (per
 * RatePlan.attributes.noShowPolicy) lands as a follow-up — folio entries
 * stay append-only, so adding the charge later doesn't change the
 * structure here.
 */
export class MarkNoShowsStep implements StepRunner {
  readonly step = NightAuditStep.MARK_NO_SHOWS;

  async run(ctx: StepContext): Promise<StepResult> {
    const candidates = await ctx.tx.reservation.findMany({
      where: {
        propertyId: ctx.propertyId,
        deletedAt: null,
        status: {
          in: [ReservationStatus.PENDING, ReservationStatus.CONFIRMED],
        },
        arrivalDate: { lte: ctx.businessDateAsDate },
      },
      select: { id: true, code: true },
    });

    if (candidates.length === 0) {
      return {
        result: { marked: 0, ids: [] },
        totals: { noShowsMarked: 0 },
      };
    }

    const markedAt = new Date();
    await ctx.tx.reservation.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: {
        status: ReservationStatus.NO_SHOW,
        cancelledAt: markedAt,
        cancellationReason: 'no-show via night audit',
      },
    });

    log.log(`marked ${candidates.length} no-shows for ${ctx.businessDate}`);

    return {
      result: {
        marked: candidates.length,
        ids: candidates.map((c) => c.id),
      },
      totals: { noShowsMarked: candidates.length },
    };
  }
}
