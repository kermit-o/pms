import { Logger } from '@nestjs/common';
import { FolioStatus, NightAuditStep, Prisma, ReservationStatus } from '@pms/db';
import type { StepContext, StepResult, StepRunner } from '../step';

const log = new Logger('PostRoomChargesStep');

/**
 * Posts one CHARGE per active in-house reservation for the business date.
 *
 * Idempotency:
 *  - Each entry uses idempotency_key = `na:room:<businessDate>:<reservationId>`,
 *    backed by the partial unique index on folio_entries(folio_id, idempotency_key).
 *  - Re-running the step after a partial failure picks up only the
 *    reservations that don't have a matching entry yet.
 *
 * Amount source:
 *  - For Sprint 3 W1 we use `RatePlan.attributes.dailyRate` if present, else
 *    `RoomType.defaultRate`. A real revenue management module replaces this
 *    in a follow-up; the contract here doesn't change.
 */
export class PostRoomChargesStep implements StepRunner {
  readonly step = NightAuditStep.POST_ROOM_CHARGES;

  async run(ctx: StepContext): Promise<StepResult> {
    const reservations = await ctx.tx.reservation.findMany({
      where: {
        propertyId: ctx.propertyId,
        deletedAt: null,
        status: { in: [ReservationStatus.CHECKED_IN] },
        arrivalDate: { lte: ctx.businessDateAsDate },
        departureDate: { gt: ctx.businessDateAsDate },
      },
      select: {
        id: true,
        currency: true,
        roomType: { select: { defaultRate: true, defaultCurrency: true } },
        ratePlan: { select: { attributes: true } },
        folio: { select: { id: true, status: true } },
      },
    });

    let posted = 0;
    let skipped = 0;
    let amountTotal = new Prisma.Decimal(0);

    for (const r of reservations) {
      if (!r.folio || r.folio.status !== FolioStatus.OPEN) {
        skipped += 1;
        continue;
      }
      const amount = resolveDailyRate(r);
      if (amount.isZero()) {
        skipped += 1;
        continue;
      }
      const idempotencyKey = `na:room:${ctx.businessDate}:${r.id}`;
      const existing = await ctx.tx.folioEntry.findFirst({
        where: { folioId: r.folio.id, idempotencyKey },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      try {
        await ctx.tx.folioEntry.create({
          data: {
            tenantId: ctx.user.tenantId,
            folioId: r.folio.id,
            type: 'CHARGE',
            description: `Room charge ${ctx.businessDate}`,
            amount,
            currency: r.currency,
            postedBy: ctx.user.sub,
            idempotencyKey,
          },
        });
        await ctx.tx.folio.update({
          where: { id: r.folio.id },
          data: { balance: { increment: amount } },
        });
        posted += 1;
        amountTotal = amountTotal.plus(amount);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Concurrent run inserted the same entry. Treat as already posted.
          skipped += 1;
          continue;
        }
        throw err;
      }
    }

    log.log(`posted=${posted} skipped=${skipped} total=${amountTotal.toString()}`);

    return {
      result: { posted, skipped, amountTotal: amountTotal.toString() },
      totals: {
        roomChargesPosted: posted,
        roomChargesAmount: amountTotal.toString(),
      },
    };
  }
}

function resolveDailyRate(r: {
  currency: string;
  roomType: { defaultRate: Prisma.Decimal; defaultCurrency: string };
  ratePlan: { attributes: Prisma.JsonValue | null } | null;
}): Prisma.Decimal {
  const attrs = r.ratePlan?.attributes;
  if (attrs && typeof attrs === 'object' && !Array.isArray(attrs) && 'dailyRate' in attrs) {
    const raw = (attrs as Record<string, unknown>).dailyRate;
    if (typeof raw === 'number' || typeof raw === 'string') {
      try {
        return new Prisma.Decimal(raw);
      } catch {
        // fall through
      }
    }
  }
  return new Prisma.Decimal(r.roomType.defaultRate);
}
