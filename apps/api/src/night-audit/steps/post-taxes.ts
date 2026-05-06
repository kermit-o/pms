import { Logger } from '@nestjs/common';
import { FolioStatus, NightAuditStep, Prisma, ReservationStatus } from '@pms/db';
import type { StepContext, StepResult, StepRunner } from '../step';

const log = new Logger('PostTaxesStep');

/**
 * Posts one TAX entry per active in-house reservation for the business date.
 *
 * Source of the tax rate (in order):
 *   1. RatePlan.attributes.taxRate (number, 0..1, e.g. 0.10 for IVA reducido)
 *   2. RoomType.attributes.taxRate
 *   3. fallback: 0.10 (Spain reduced VAT for hotel stays — RFC default)
 *
 * Base of the calculation:
 *   - The room charge for the same business date (lookup by idempotency
 *     key na:room:<date>:<reservationId>). If POST_ROOM_CHARGES skipped a
 *     reservation (no folio open, zero rate, etc.) the tax step skips it
 *     too — no orphan tax entries.
 *
 * Idempotency:
 *   - Each entry uses idempotency_key na:tax:<businessDate>:<reservationId>.
 */
export class PostTaxesStep implements StepRunner {
  readonly step = NightAuditStep.POST_TAXES;

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
        roomType: { select: { attributes: true } },
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
      const taxRate = resolveTaxRate(r);
      if (taxRate.isZero()) {
        skipped += 1;
        continue;
      }
      const baseEntry = await ctx.tx.folioEntry.findFirst({
        where: {
          folioId: r.folio.id,
          idempotencyKey: `na:room:${ctx.businessDate}:${r.id}`,
        },
        select: { amount: true },
      });
      if (!baseEntry) {
        skipped += 1;
        continue;
      }

      const taxAmount = new Prisma.Decimal(baseEntry.amount).times(taxRate).toDecimalPlaces(2);
      if (taxAmount.isZero()) {
        skipped += 1;
        continue;
      }

      const idempotencyKey = `na:tax:${ctx.businessDate}:${r.id}`;
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
            type: 'TAX',
            description: `Tax ${ctx.businessDate} (${taxRate.times(100).toString()}%)`,
            amount: taxAmount,
            currency: r.currency,
            postedBy: ctx.user.sub,
            idempotencyKey,
          },
        });
        await ctx.tx.folio.update({
          where: { id: r.folio.id },
          data: { balance: { increment: taxAmount } },
        });
        posted += 1;
        amountTotal = amountTotal.plus(taxAmount);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
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
        taxesPosted: posted,
        taxesAmount: amountTotal.toString(),
      },
    };
  }
}

function resolveTaxRate(r: {
  roomType: { attributes: Prisma.JsonValue | null };
  ratePlan: { attributes: Prisma.JsonValue | null } | null;
}): Prisma.Decimal {
  const fromPlan = readNumeric(r.ratePlan?.attributes, 'taxRate');
  if (fromPlan != null) return new Prisma.Decimal(fromPlan);
  const fromRoomType = readNumeric(r.roomType.attributes, 'taxRate');
  if (fromRoomType != null) return new Prisma.Decimal(fromRoomType);
  return new Prisma.Decimal('0.10');
}

function readNumeric(
  attrs: Prisma.JsonValue | null | undefined,
  key: string,
): number | string | null {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return null;
  const raw = (attrs as Record<string, unknown>)[key];
  if (typeof raw === 'number' || typeof raw === 'string') return raw;
  return null;
}
