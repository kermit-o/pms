import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FolioStatus, Prisma, TaxCategory } from '@pms/db';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';
import type { AuthUser } from '../auth';
import type { Env } from '../config/env.schema';
import { AddChargeDto, AddPaymentDto, ReopenFolioDto } from './dto';
import { PropertyTaxConfigService } from './property-tax-config.service';
import { breakdownFromGross, breakdownFromNet, type TaxBreakdown } from './tax-calculator';

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
    private readonly taxConfig: PropertyTaxConfigService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private isTaxBreakdownEnabled(): boolean {
    return this.config.get('FOLIO_TAX_BREAKDOWN_ENABLED', { infer: true });
  }

  async findOne(user: AuthUser, correlationId: string, id: string): Promise<FolioDetail> {
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

  /**
   * Sprint 13 — lookup folio por reservation code (lo que pide el
   * operador en lenguaje natural: "qué debe la reserva BBM01-AB12").
   * Une la búsqueda de reserva + folio en un único `withTenant` para
   * mantener la atomicidad de RLS.
   */
  async findByReservationCode(
    user: AuthUser,
    correlationId: string,
    propertyId: string,
    reservationCode: string,
  ): Promise<FolioDetail & { reservationCode: string }> {
    const ctx = tenantCtx(user, correlationId);
    const found = await this.prisma.withTenant(ctx, async (tx) => {
      const reservation = await tx.reservation.findFirst({
        where: { propertyId, code: reservationCode, deletedAt: null },
        select: { id: true, code: true, folio: { select: FOLIO_DETAIL_SELECT } },
      });
      if (!reservation) return null;
      if (!reservation.folio) return null;
      return { code: reservation.code, folio: reservation.folio };
    });
    if (!found) {
      throw new NotFoundException(
        `Reservation ${reservationCode} not found or has no folio in property ${propertyId}`,
      );
    }
    return { ...toFolioDetail(found.folio), reservationCode: found.code };
  }

  async addCharge(
    user: AuthUser,
    correlationId: string,
    folioId: string,
    input: AddChargeDto,
  ): Promise<{
    entryId: string;
    balance: string;
    deduplicated: boolean;
    breakdown: TaxBreakdownDto | null;
  }> {
    const ctx = tenantCtx(user, correlationId);
    const taxEnabled = this.isTaxBreakdownEnabled();

    if (taxEnabled && !input.taxCategory) {
      throw new BadRequestException(
        'taxCategory is required when FOLIO_TAX_BREAKDOWN_ENABLED is true',
      );
    }

    const result = await this.prisma.withTenant(
      ctx,
      async (tx): Promise<AddChargeTxResult> => {
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
              amount: (input.amount ?? input.netAmount ?? 0).toString(),
              type: input.type,
              postedAt: new Date(),
              breakdown: null,
              taxCategory: input.taxCategory ?? null,
            };
          }
        }

        const breakdown = input.taxCategory
          ? await this.computeBreakdown(tx, folio.reservation.propertyId, input)
          : null;
        const amount = breakdown ? breakdown.gross : new Prisma.Decimal(input.amount ?? 0);

        let entryId: string;
        try {
          const created = await tx.folioEntry.create({
            data: {
              tenantId: user.tenantId,
              folioId,
              type: input.type,
              description: input.description,
              amount,
              netAmount: breakdown?.net ?? null,
              taxRate: breakdown?.taxRate ?? null,
              taxAmount: breakdown?.tax ?? null,
              taxCategory: input.taxCategory ?? null,
              currency: folio.currency,
              postedBy: user.sub,
              idempotencyKey: input.idempotencyKey ?? null,
            },
            select: { id: true, postedAt: true },
          });
          entryId = created.id;
        } catch (err) {
          if (isUniqueViolation(err) && input.idempotencyKey) {
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
              amount: amount.toString(),
              type: input.type,
              postedAt: new Date(),
              breakdown: breakdown ? toBreakdownDto(breakdown) : null,
              taxCategory: input.taxCategory ?? null,
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
          amount: amount.toString(),
          type: input.type,
          postedAt: new Date(),
          breakdown: breakdown ? toBreakdownDto(breakdown) : null,
          taxCategory: input.taxCategory ?? null,
        };
      },
    );

    if (!result.deduplicated) {
      await this.events.publish('folio.charge_added', ctx, {
        folioId,
        reservationId: result.reservationId,
        propertyId: result.propertyId,
        entryId: result.entryId,
        description: result.description,
        amount: result.amount,
        currency: result.currency,
        type: result.type === 'ADJUSTMENT' ? 'CHARGE' : result.type,
        newBalance: result.balance,
        postedAt: result.postedAt.toISOString(),
        ...(result.breakdown
          ? {
              netAmount: result.breakdown.net,
              taxAmount: result.breakdown.tax,
              taxRate: result.breakdown.taxRate,
              taxCategory: result.taxCategory,
            }
          : {}),
      });
    }

    return {
      entryId: result.entryId,
      balance: result.balance,
      deduplicated: result.deduplicated,
      breakdown: result.breakdown,
    };
  }

  private async computeBreakdown(
    tx: Prisma.TransactionClient,
    propertyId: string,
    input: AddChargeDto,
  ): Promise<TaxBreakdown> {
    if (!input.taxCategory) {
      throw new BadRequestException('taxCategory required for breakdown');
    }
    const rate =
      input.taxRate !== undefined
        ? new Prisma.Decimal(input.taxRate)
        : await this.taxConfig.resolveRate(tx, propertyId, input.taxCategory);
    if (rate === null) {
      throw new BadRequestException(
        `no PropertyTaxConfig found for category ${input.taxCategory} in property ${propertyId}`,
      );
    }
    if (input.netAmount !== undefined) {
      return breakdownFromNet({ net: input.netAmount, taxRate: rate });
    }
    if (input.amount !== undefined) {
      return breakdownFromGross({ gross: input.amount, taxRate: rate });
    }
    throw new BadRequestException('amount or netAmount required');
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

  async close(user: AuthUser, correlationId: string, folioId: string): Promise<{ id: string }> {
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
        throw new ConflictException(`Folio in status ${folio.status} cannot be closed`);
      }
      if (!new Prisma.Decimal(folio.balance).isZero()) {
        throw new ConflictException(`Folio balance must be 0 to close (current ${folio.balance})`);
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

  /**
   * RFC-001 §3.3 — override del city tax aplicado por el NA.
   *
   * Crea una FolioEntry ADJUSTMENT con taxCategory=CITY_TAX cuyo
   * importe es (newAmount - sum(CITY_TAX entries existentes)). Si
   * newAmount < total existente, el ADJUSTMENT es negativo (descuento).
   *
   * Auditado en el event folio.city_tax_overridden con el motivo
   * (>= 10 chars, validado en el DTO).
   */
  async overrideCityTax(
    user: AuthUser,
    correlationId: string,
    folioId: string,
    input: { newAmount: number; reason: string },
  ): Promise<{ entryId: string; balance: string; deltaAmount: string }> {
    const ctx = tenantCtx(user, correlationId);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const folio = await loadOpenFolio(tx, folioId);
      const existing = await tx.folioEntry.findMany({
        where: { folioId, taxCategory: TaxCategory.CITY_TAX },
        select: { amount: true },
      });
      const currentTotal = existing.reduce(
        (acc, e) => acc.plus(e.amount),
        new Prisma.Decimal(0),
      );
      const newAmount = new Prisma.Decimal(input.newAmount);
      const delta = newAmount.minus(currentTotal);

      if (delta.isZero()) {
        return {
          entryId: null as string | null,
          balance: folio.balance.toString(),
          deltaAmount: '0',
          reservationId: folio.reservationId,
          propertyId: folio.reservation.propertyId,
          originalAmount: currentTotal.toString(),
          newAmount: newAmount.toString(),
        };
      }

      const created = await tx.folioEntry.create({
        data: {
          tenantId: user.tenantId,
          folioId,
          type: 'ADJUSTMENT',
          description: `City tax override: ${input.reason.slice(0, 200)}`,
          amount: delta,
          netAmount: delta,
          taxRate: new Prisma.Decimal(0),
          taxAmount: new Prisma.Decimal(0),
          taxCategory: TaxCategory.CITY_TAX,
          currency: folio.currency,
          postedBy: user.sub,
          attributes: {
            override: true,
            originalAmount: currentTotal.toString(),
            newAmount: newAmount.toString(),
            reason: input.reason,
          },
        },
        select: { id: true },
      });
      const newBalance = new Prisma.Decimal(folio.balance).plus(delta);
      await tx.folio.update({ where: { id: folioId }, data: { balance: newBalance } });

      return {
        entryId: created.id,
        balance: newBalance.toString(),
        deltaAmount: delta.toString(),
        reservationId: folio.reservationId,
        propertyId: folio.reservation.propertyId,
        originalAmount: currentTotal.toString(),
        newAmount: newAmount.toString(),
      };
    });

    if (result.entryId) {
      await this.events.publish('folio.city_tax_overridden', ctx, {
        folioId,
        reservationId: result.reservationId,
        propertyId: result.propertyId,
        entryId: result.entryId,
        originalAmount: result.originalAmount,
        newAmount: result.newAmount,
        reason: input.reason,
        actorId: user.sub,
      });
    }

    return {
      entryId: result.entryId ?? '',
      balance: result.balance,
      deltaAmount: result.deltaAmount,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AddChargeTxResult {
  entryId: string;
  balance: string;
  deduplicated: boolean;
  reservationId: string;
  propertyId: string;
  currency: string;
  description: string;
  amount: string;
  type: 'CHARGE' | 'TAX' | 'ADJUSTMENT';
  postedAt: Date;
  breakdown: TaxBreakdownDto | null;
  taxCategory: TaxCategory | null;
}

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
    throw new ConflictException(`Folio in status ${folio.status} cannot accept new entries`);
  }
  return folio;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
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
      netAmount: true,
      taxRate: true,
      taxAmount: true,
      taxCategory: true,
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
  netAmount: string | null;
  taxRate: string | null;
  taxAmount: string | null;
  taxCategory: TaxCategory | null;
}

export interface TaxBreakdownDto {
  net: string;
  tax: string;
  gross: string;
  taxRate: string;
}

function toBreakdownDto(b: TaxBreakdown): TaxBreakdownDto {
  return {
    net: b.net.toString(),
    tax: b.tax.toString(),
    gross: b.gross.toString(),
    taxRate: b.taxRate.toString(),
  };
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
      netAmount: e.netAmount?.toString() ?? null,
      taxRate: e.taxRate?.toString() ?? null,
      taxAmount: e.taxAmount?.toString() ?? null,
      taxCategory: e.taxCategory,
    })),
  };
}
