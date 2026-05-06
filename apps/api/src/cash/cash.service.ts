import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pms/db';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';
import type { AuthUser } from '../auth';
import { UpsertReconciliationDto } from './dto';

/**
 * Cash drawer reconciliation. Sprint 3 W5.
 *
 * Expected amount comes from the sum of CASH PAYMENT entries on the
 * business date. Folio payments are stored as negative amounts (Sprint 2
 * W3 convention), so we negate the sum to express it as a positive
 * "cash that should be in the drawer" figure.
 *
 * One row per (property, business_date). Upsert overwrites the count and
 * recomputes the discrepancy. The night-audit CLOSE_DAY step queries this
 * service to gate the day close.
 */
@Injectable()
export class CashService {
  private readonly log = new Logger(CashService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventbusService,
  ) {}

  async getOrEmpty(
    user: AuthUser,
    correlationId: string,
    propertyId: string,
    businessDate: string,
  ): Promise<ReconciliationView> {
    const ctx = tenantCtx(user, correlationId);
    return this.prisma.withTenant(ctx, async (tx) => {
      const businessDateAsDate = new Date(businessDate);
      const [existing, expected] = await Promise.all([
        tx.cashDrawerReconciliation.findFirst({
          where: { propertyId, businessDate: businessDateAsDate },
        }),
        sumCashPayments(tx, user.tenantId, businessDateAsDate),
      ]);
      if (existing) {
        return {
          id: existing.id,
          propertyId: existing.propertyId,
          businessDate,
          currency: existing.currency,
          expectedAmount: expected.toString(),
          countedAmount: existing.countedAmount.toString(),
          discrepancy: existing.discrepancy.toString(),
          toleranceCents: existing.toleranceCents,
          countedByUserId: existing.countedByUserId,
          notes: existing.notes,
          createdAt: existing.createdAt.toISOString(),
          updatedAt: existing.updatedAt.toISOString(),
        };
      }
      return {
        id: null,
        propertyId,
        businessDate,
        currency: 'EUR',
        expectedAmount: expected.toString(),
        countedAmount: '0',
        discrepancy: '0',
        toleranceCents: 0,
        countedByUserId: null,
        notes: null,
        createdAt: null,
        updatedAt: null,
      };
    });
  }

  async upsert(
    user: AuthUser,
    correlationId: string,
    input: UpsertReconciliationDto,
  ): Promise<ReconciliationView> {
    const ctx = tenantCtx(user, correlationId);
    const businessDateAsDate = new Date(input.businessDate);
    const counted = new Prisma.Decimal(input.countedAmount);
    const tolerance = input.toleranceCents ?? 0;

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const expected = await sumCashPayments(tx, user.tenantId, businessDateAsDate);
      const discrepancy = counted.minus(expected);

      const existing = await tx.cashDrawerReconciliation.findFirst({
        where: {
          propertyId: input.propertyId,
          businessDate: businessDateAsDate,
        },
      });

      const baseData = {
        currency: input.currency,
        expectedAmount: expected,
        countedAmount: counted,
        discrepancy,
        toleranceCents: tolerance,
        countedByUserId: user.sub,
        notes: input.notes ?? null,
      };

      const row = existing
        ? await tx.cashDrawerReconciliation.update({
            where: {
              propertyId_businessDate: {
                propertyId: input.propertyId,
                businessDate: businessDateAsDate,
              },
            },
            data: baseData,
          })
        : await tx.cashDrawerReconciliation.create({
            data: {
              tenantId: user.tenantId,
              propertyId: input.propertyId,
              businessDate: businessDateAsDate,
              ...baseData,
            },
          });

      return { row, expected, discrepancy, tolerance };
    });

    await this.events.publish('cash.reconciliation_created', ctx, {
      reconciliationId: result.row.id,
      propertyId: input.propertyId,
      businessDate: input.businessDate,
      expectedAmount: result.expected.toString(),
      countedAmount: counted.toString(),
      discrepancy: result.discrepancy.toString(),
      currency: input.currency,
      countedByUserId: user.sub,
    });

    if (Math.abs(result.discrepancy.times(100).toNumber()) > result.tolerance) {
      await this.events.publish('cash.reconciliation_discrepancy', ctx, {
        reconciliationId: result.row.id,
        propertyId: input.propertyId,
        businessDate: input.businessDate,
        expectedAmount: result.expected.toString(),
        countedAmount: counted.toString(),
        discrepancy: result.discrepancy.toString(),
        currency: input.currency,
        toleranceCents: result.tolerance,
      });
    }

    return {
      id: result.row.id,
      propertyId: result.row.propertyId,
      businessDate: input.businessDate,
      currency: result.row.currency,
      expectedAmount: result.expected.toString(),
      countedAmount: counted.toString(),
      discrepancy: result.discrepancy.toString(),
      toleranceCents: result.row.toleranceCents,
      countedByUserId: result.row.countedByUserId,
      notes: result.row.notes,
      createdAt: result.row.createdAt.toISOString(),
      updatedAt: result.row.updatedAt.toISOString(),
    };
  }

  /**
   * Returns the existing reconciliation (or throws NotFound). Used by the
   * night-audit CLOSE_DAY step to gate the close.
   */
  async require(
    user: AuthUser,
    correlationId: string,
    propertyId: string,
    businessDate: string,
  ): Promise<ReconciliationView> {
    const view = await this.getOrEmpty(user, correlationId, propertyId, businessDate);
    if (!view.id) {
      throw new NotFoundException(`No cash reconciliation for ${propertyId} on ${businessDate}`);
    }
    return view;
  }
}

// ---------------------------------------------------------------------------

async function sumCashPayments(
  tx: Prisma.TransactionClient,
  tenantId: string,
  businessDateAsDate: Date,
): Promise<Prisma.Decimal> {
  const dayStart = startOfUtcDay(businessDateAsDate);
  const dayEnd = endOfUtcDay(businessDateAsDate);

  // Folio payments are stored with a negative amount and
  // attributes.paymentMethod = 'CASH'. Sum amounts and negate to get the
  // positive expected drawer total.
  //
  // We can't filter by JSON path in a portable way through groupBy, so we
  // pull the matching rows and sum in JS. The dataset is small (one
  // property's cash payments per day).
  const rows = await tx.folioEntry.findMany({
    where: {
      tenantId,
      type: 'PAYMENT',
      postedAt: { gte: dayStart, lt: dayEnd },
      attributes: { path: ['paymentMethod'], equals: 'CASH' },
    },
    select: { amount: true },
  });
  let total = new Prisma.Decimal(0);
  for (const r of rows) {
    total = total.plus(new Prisma.Decimal(r.amount));
  }
  return total.negated();
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
}

function tenantCtx(user: AuthUser, correlationId: string) {
  return { tenantId: user.tenantId, actorId: user.sub, correlationId };
}

export interface ReconciliationView {
  id: string | null;
  propertyId: string;
  businessDate: string;
  currency: string;
  expectedAmount: string;
  countedAmount: string;
  discrepancy: string;
  toleranceCents: number;
  countedByUserId: string | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
