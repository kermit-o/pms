import { Logger } from '@nestjs/common';
import { FolioStatus, NightAuditStep, Prisma, ReservationStatus } from '@pms/db';
import type { StepContext, StepResult, StepRunner } from '../step';

const log = new Logger('PostPackagesStep');

interface PackageDef {
  code: string;
  name: string;
  amount: string | number;
  perGuest?: boolean;
}

/**
 * Posts package CHARGE entries (breakfast, parking, half board, etc.) per
 * reservation per business date.
 *
 * Source: RatePlan.attributes.packages = [{ code, name, amount, perGuest? }]
 *   - perGuest=true multiplies amount by (adults + children).
 *   - Missing/invalid arrays → step is a no-op for that reservation.
 *
 * Idempotency: na:pkg:<businessDate>:<reservationId>:<pkgCode>
 */
export class PostPackagesStep implements StepRunner {
  readonly step = NightAuditStep.POST_PACKAGES;

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
        adults: true,
        children: true,
        currency: true,
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
      const packages = readPackages(r.ratePlan?.attributes);
      if (packages.length === 0) {
        skipped += 1;
        continue;
      }
      const occupancy = r.adults + r.children;

      for (const pkg of packages) {
        let unitAmount: Prisma.Decimal;
        try {
          unitAmount = new Prisma.Decimal(pkg.amount);
        } catch {
          skipped += 1;
          continue;
        }
        const amount = pkg.perGuest ? unitAmount.times(occupancy) : unitAmount;
        if (amount.isZero()) {
          skipped += 1;
          continue;
        }

        const idempotencyKey = `na:pkg:${ctx.businessDate}:${r.id}:${pkg.code}`;
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
              description: `${pkg.name} ${ctx.businessDate}`,
              amount,
              currency: r.currency,
              postedBy: ctx.user.sub,
              idempotencyKey,
              attributes: { packageCode: pkg.code },
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
            skipped += 1;
            continue;
          }
          throw err;
        }
      }
    }

    log.log(`posted=${posted} skipped=${skipped} total=${amountTotal.toString()}`);

    return {
      result: { posted, skipped, amountTotal: amountTotal.toString() },
      totals: {
        packagesPosted: posted,
        packagesAmount: amountTotal.toString(),
      },
    };
  }
}

function readPackages(attrs: Prisma.JsonValue | null | undefined): PackageDef[] {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return [];
  const raw = (attrs as Record<string, unknown>).packages;
  if (!Array.isArray(raw)) return [];
  const out: PackageDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const code = typeof obj.code === 'string' ? obj.code : null;
    const name = typeof obj.name === 'string' ? obj.name : null;
    const amount = obj.amount;
    if (!code || !name || (typeof amount !== 'number' && typeof amount !== 'string')) {
      continue;
    }
    out.push({
      code,
      name,
      amount,
      perGuest: obj.perGuest === true,
    });
  }
  return out;
}
