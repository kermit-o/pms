import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  FolioStatus,
  Prisma,
} from '@pms/db';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';
import type { AuthUser } from '../auth';
import { AddChargeDto, AddPaymentDto, ReopenFolioDto } from './dto';

/**
 * Folio domain service. Sprint 2 W3.
 *
 * Append-only model:
 *  - charges and payments are inserted as FolioEntry rows.
 *  - balance is recomputed in the same transaction (sum of signed amounts:
 *    CHARGE/TAX positive, PAYMENT/DISCOUNT negative).
 *  - existing entries are never UPDATEd or DELETEd; corrections are entered
 *    as inverse rows by the user.
 *
 * Idempotency:
 *  - charges and payments accept an optional idempotency_key. The
 *    (folio_id, idempotency_key) unique index makes duplicate POSTs safe;
 *    we catch the unique violation and return the previously-stored entry.
 */
@Injectable()
export class FolioService {
  private readonly log = new Logger(FolioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventbusService,
  ) {}

  async findOne(
    user: AuthUser,
    correlationId: string,
    id: string,
  ): Promise<FolioDetail> {
    const ctx = tenantCtx(user, correlationId);
    const found = await this.prisma.withTenant(ctx, (tx) =>
      tx.folio.findFirst({
        where: { id },
        select: FOLIO_DETAIL_SELECT,
      }),
    );
    if (!found) throw new NotFoundException(`Folio ${id} not found`);
    return toFolioDetail(found);
  }

  async addCharge(
    user: AuthUser,
    correlationId: string,
    folioId: string,
    input: AddChargeDto,
  ): Promise<{ entryId: string; balance: string; deduplicated: boolean }> {
    const ctx = tenantCtx(user, correlationId);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const folio = await loadOpenFolio(tx, folioId);
      if (input.currency && input.currency !== folio.currency) {
        throw new BadRequestException(
          `currency ${input.currency} does not match folio ${folio.currency}`,
        );
      }

      if (input.idempotencyKey) {
        const existing = await tx.folioEntry.findFirst({
          where: { folioId, idempotencyKey: input.idempotencyKey },
          select: { id: true },
        });
        if (existing) {
          return {
            entryId: existing.id,
            balance: folio.balance.toString(),
            deduplicated: true,
            reservationId: folio.reservationId,
            propertyId: folio.reservation.propertyId,
            currency: folio.currency,
            description: input.description,
            amount: input.amount,
            type: input.type,
            postedAt: new Date(),
          };
        }
      }

      const amount = new Prisma.Decimal(input.amount);

      let entryId: string;
      try {
        const created = await tx.folioEntry.create({
          data: {
            tenantId: user.tenantId,
            folioId,
            type: input.type,
            description: input.description,
            amount,
            currency: folio.currency,
            postedBy: user.sub,
            idempotencyKey: input.idempotencyKey ?? null,
          },
          select: { id: true, postedAt: true },
        });
        entryId = created.id;
      } catch (err) {
        if (isUniqueViolation(err)) {
          const existing = await tx.folioEntry.findFirst({
            where: { folioId, idempotencyKey: input.idempotencyKey },
            select: { id: true },
          });
          if (!existing) throw err;
          return {
            entryId: existing.id,
            balance: folio.balance.toString(),
            deduplicated: true,
            reservationId: folio.reservationId,
            propertyId: folio.reservation.propertyId,
            currency: folio.currency,
            description: input.description,
            amount: input.amount,
            type: input.type,
            postedAt: new Date(),
          };
        }
        throw err;
      }

      const newBalance = new Prisma.Decimal(folio.balance).plus(amount);
      await tx.folio.update({
        where: { id: folioId },
        data: { balance: newBalance },
      });

      return {
        entryId,
        balance: newBalance.toString(),
        deduplicated: false,
        reservationId: folio.reservationId,
        propertyId: folio.reservation.propertyId,
        currency: folio.currency,
        description: input.description,
        amount: input.amount,
        type: input.type,
        postedAt: new Date(),
      };
    });

    if (!result.deduplicated) {
      await this.events.publish('folio.charge_added', ctx, {
        folioId,
        reservationId: result.reservationId,
        propertyId: result.propertyId,
        entryId: result.entryId,
        description: result.description,
        amount: result.amount.toString(),
        currency: result.currency,
        type: result.type,
        newBalance: result.balance,
        postedAt: result.postedAt.toISOString(),
      });
    }

    return {
      entryId: result.entryId,
      balance: result.balance,
      deduplicated: result.deduplicated,
    };
  }

  async addPayment(
    user: AuthUser,
    correlationId: string,
    folioId: string,
    input: AddPaymentDto,
  ): Promise<{ entryId: string; balance: string; deduplicated: boolean }> {
    const ctx = tenantCtx(user, correlationId);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const folio = await loadOpenFolio(tx, folioId);
      if (input.currency && input.currency !== folio.currency) {
        throw new BadRequestException(
          `currency ${input.currency} does not match folio ${folio.currency}`,
        );
      }

      if (input.idempotencyKey) {
        const existing = await tx.folioEntry.findFirst({
          where: { folioId, idempotencyKey: input.idempotencyKey },
          select: { id: true },
        });
        if (existing) {
          return {
            entryId: existing.id,
            balance: folio.balance.toString(),
            deduplicated: true,
            reservationId: folio.reservationId,
            propertyId: folio.reservation.propertyId,
            currency: folio.currency,
            description: input.description,
            amount: input.amount,
            paymentMethod: input.paymentMethod,
            reference: input.reference ?? null,
            postedAt: new Date(),
          };
        }
      }

      const signedAmount = new Prisma.Decimal(input.amount).neg();

      let entryId: string;
      try {
        const created = await tx.folioEntry.create({
          data: {
            tenantId: user.tenantId,
            folioId,
            type: 'PAYMENT',
            description: input.description,
            amount: signedAmount,
            currency: folio.currency,
            postedBy: user.sub,
            idempotencyKey: input.idempotencyKey ?? null,
            attributes: {
              paymentMethod: input.paymentMethod,
              ...(input.reference ? { reference: input.reference } : {}),
            },
          },
          select: { id: true },
        });
        entryId = created.id;
      } catch (err) {
        if (isUniqueViolation(err)) {
          const existing = await tx.folioEntry.findFirst({
            where: { folioId, idempotencyKey: input.idempotencyKey },
            select: { id: true },
          });
          if (!existing) throw err;
          return {
            entryId: existing.id,
            balance: folio.balance.toString(),
            deduplicated: true,
            reservationId: folio.reservationId,
            propertyId: folio.reservation.propertyId,
            currency: folio.currency,
            description: input.description,
            amount: input.amount,
            paymentMethod: input.paymentMethod,
            reference: input.reference ?? null,
            postedAt: new Date(),
          };
        }
        throw err;
      }

      const newBalance = new Prisma.Decimal(folio.balance).plus(signedAmount);
      await tx.folio.update({
        where: { id: folioId },
        data: { balance: newBalance },
      });

      return {
        entryId,
        balance: newBalance.toString(),
        deduplicated: false,
        reservationId: folio.reservationId,
        propertyId: folio.reservation.propertyId,
        currency: folio.currency,
        description: input.description,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        reference: input.reference ?? null,
        postedAt: new Date(),
      };
    });

    if (!result.deduplicated) {
      await this.events.publish('folio.payment_received', ctx, {
        folioId,
        reservationId: result.reservationId,
        propertyId: result.propertyId,
        entryId: result.entryId,
        description: result.description,
        amount: result.amount.toString(),
        currency: result.currency,
        paymentMethod: result.paymentMethod,
        reference: result.reference,
        newBalance: result.balance,
        postedAt: result.postedAt.toISOString(),
      });
    }

    return {
      entryId: result.entryId,
      balance: result.balance,
      deduplicated: result.deduplicated,
    };
  }

  async close(
    user: AuthUser,
    correlationId: string,
    folioId: string,
  ): Promise<{ id: string }> {
    const ctx = tenantCtx(user, correlationId);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const folio = await tx.folio.findFirst({
        where: { id: folioId },
        select: {
          id: true,
          status: true,
          balance: true,
          reservationId: true,
          reservation: { select: { propertyId: true } },
        },
      });
      if (!folio) throw new NotFoundException(`Folio ${folioId} not found`);
      if (folio.status !== FolioStatus.OPEN) {
        throw new ConflictException(
          `Folio in status ${folio.status} cannot be closed`,
        );
      }
      if (!new Prisma.Decimal(folio.balance).isZero()) {
        throw new ConflictException(
          `Folio balance must be 0 to close (current ${folio.balance})`,
        );
      }
      const closedAt = new Date();
      await tx.folio.update({
        where: { id: folioId },
        data: { status: FolioStatus.SETTLED, closedAt },
      });
      return {
        propertyId: folio.reservation.propertyId,
        reservationId: folio.reservationId,
        finalBalance: folio.balance.toString(),
        closedAt,
      };
    });

    await this.events.publish('folio.closed', ctx, {
      folioId,
      reservationId: result.reservationId,
      propertyId: result.propertyId,
      closedAt: result.closedAt.toISOString(),
      finalBalance: result.finalBalance,
    });

    return { id: folioId };
  }

  async reopen(
    user: AuthUser,
    correlationId: string,
    folioId: string,
    input: ReopenFolioDto,
  ): Promise<{ id: string }> {
    const ctx = tenantCtx(user, correlationId);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const folio = await tx.folio.findFirst({
        where: { id: folioId },
        select: {
          id: true,
          status: true,
          reservationId: true,
          reservation: { select: { propertyId: true } },
        },
      });
      if (!folio) throw new NotFoundException(`Folio ${folioId} not found`);
      if (folio.status === FolioStatus.OPEN) {
        throw new ConflictException('Folio is already OPEN');
      }
      const reopenedAt = new Date();
      await tx.folio.update({
        where: { id: folioId },
        data: { status: FolioStatus.OPEN, closedAt: null },
      });
      return {
        propertyId: folio.reservation.propertyId,
        reservationId: folio.reservationId,
        reopenedAt,
      };
    });

    await this.events.publish('folio.reopened', ctx, {
      folioId,
      reservationId: result.reservationId,
      propertyId: result.propertyId,
      reopenedAt: result.reopenedAt.toISOString(),
      reason: input.reason,
    });

    return { id: folioId };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tenantCtx(user: AuthUser, correlationId: string) {
  return {
    tenantId: user.tenantId,
    actorId: user.sub,
    correlationId,
  };
}

async function loadOpenFolio(tx: Prisma.TransactionClient, folioId: string) {
  const folio = await tx.folio.findFirst({
    where: { id: folioId },
    select: {
      id: true,
      status: true,
      balance: true,
      currency: true,
      reservationId: true,
      reservation: { select: { propertyId: true } },
    },
  });
  if (!folio) throw new NotFoundException(`Folio ${folioId} not found`);
  if (folio.status !== FolioStatus.OPEN) {
    throw new ConflictException(
      `Folio in status ${folio.status} cannot accept new entries`,
    );
  }
  return folio;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

const FOLIO_DETAIL_SELECT = {
  id: true,
  status: true,
  balance: true,
  currency: true,
  closedAt: true,
  reservationId: true,
  createdAt: true,
  updatedAt: true,
  entries: {
    select: {
      id: true,
      type: true,
      description: true,
      amount: true,
      currency: true,
      postedAt: true,
      postedBy: true,
      attributes: true,
    },
    orderBy: { postedAt: 'desc' as const },
  },
} satisfies Prisma.FolioSelect;

type FolioDetailRow = Prisma.FolioGetPayload<{ select: typeof FOLIO_DETAIL_SELECT }>;

export interface FolioEntryDto {
  id: string;
  type: string;
  description: string;
  amount: string;
  currency: string;
  postedAt: string;
  postedBy: string | null;
  attributes: unknown;
}

export interface FolioDetail {
  id: string;
  status: string;
  balance: string;
  currency: string;
  closedAt: string | null;
  reservationId: string;
  createdAt: string;
  updatedAt: string;
  entries: FolioEntryDto[];
}

function toFolioDetail(row: FolioDetailRow): FolioDetail {
  return {
    id: row.id,
    status: row.status,
    balance: row.balance.toString(),
    currency: row.currency,
    closedAt: row.closedAt?.toISOString() ?? null,
    reservationId: row.reservationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    entries: row.entries.map((e) => ({
      id: e.id,
      type: e.type,
      description: e.description,
      amount: e.amount.toString(),
      currency: e.currency,
      postedAt: e.postedAt.toISOString(),
      postedBy: e.postedBy,
      attributes: e.attributes,
    })),
  };
}
