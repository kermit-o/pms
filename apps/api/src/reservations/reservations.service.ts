import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  Prisma,
  ReservationSource,
  ReservationStatus as PrismaReservationStatus,
} from '@pms/db';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';
import type { AuthUser } from '../auth';
import {
  AssignRoomDto,
  CancelReservationDto,
  CheckInDto,
  CheckOutDto,
  CreateReservationDto,
  PatchReservationDto,
} from './dto';
import {
  IllegalReservationTransitionError,
  assertTransition,
} from './reservation-status';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class ReservationsService {
  private readonly log = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventbusService,
  ) {}

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  async create(
    user: AuthUser,
    correlationId: string,
    input: CreateReservationDto,
  ): Promise<{ id: string; code: string }> {
    return this.createInternal(user, correlationId, input, false);
  }

  async createWalkIn(
    user: AuthUser,
    correlationId: string,
    input: CreateReservationDto,
  ): Promise<{ id: string; code: string }> {
    return this.createInternal(user, correlationId, input, true);
  }

  private async createInternal(
    user: AuthUser,
    correlationId: string,
    input: CreateReservationDto,
    walkIn: boolean,
  ): Promise<{ id: string; code: string }> {
    const ctx = tenantCtx(user, correlationId);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: input.propertyId, deletedAt: null },
        select: { id: true, code: true, currency: true },
      });
      if (!property) {
        throw new NotFoundException(`Property ${input.propertyId} not found`);
      }

      const roomType = await tx.roomType.findFirst({
        where: { id: input.roomTypeId, propertyId: property.id, deletedAt: null },
        select: { id: true },
      });
      if (!roomType) {
        throw new BadRequestException(
          `RoomType ${input.roomTypeId} not found for property ${property.id}`,
        );
      }

      if (input.ratePlanId) {
        const ratePlan = await tx.ratePlan.findFirst({
          where: {
            id: input.ratePlanId,
            propertyId: property.id,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!ratePlan) {
          throw new BadRequestException(
            `RatePlan ${input.ratePlanId} not found for property ${property.id}`,
          );
        }
      }

      const guestId =
        input.guestId ?? (await ensureAdHocGuest(tx, user.tenantId, input));

      const code = generateReservationCode(property.code);

      const status: PrismaReservationStatus = walkIn
        ? PrismaReservationStatus.CHECKED_IN
        : PrismaReservationStatus.PENDING;

      const source: ReservationSource = walkIn
        ? ReservationSource.WALK_IN
        : ReservationSource.DIRECT;

      const reservation = await tx.reservation.create({
        data: {
          tenantId: user.tenantId,
          propertyId: property.id,
          code,
          status,
          arrivalDate: new Date(input.arrival),
          departureDate: new Date(input.departure),
          adults: input.occupancy.adults,
          children: input.occupancy.children,
          roomTypeId: input.roomTypeId,
          ratePlanId: input.ratePlanId ?? null,
          totalAmount: new Prisma.Decimal(input.totalAmount ?? 0),
          currency: input.currency ?? property.currency,
          source,
          specialRequests: input.specialRequests ?? null,
          notes: input.notes ?? null,
          checkedInAt: walkIn ? new Date() : null,
          guests: {
            create: {
              tenantId: user.tenantId,
              guestId,
              isPrimary: true,
            },
          },
          folio: {
            create: {
              tenantId: user.tenantId,
              currency: input.currency ?? property.currency,
            },
          },
        },
      });

      return { reservation, code, propertyId: property.id };
    });

    await this.events.publish('reservation.created', ctx, {
      reservationId: result.reservation.id,
      propertyId: result.propertyId,
      code: result.code,
      arrivalDate: input.arrival,
      departureDate: input.departure,
      roomTypeId: input.roomTypeId,
      ratePlanId: input.ratePlanId ?? null,
      adults: input.occupancy.adults,
      children: input.occupancy.children,
      source: walkIn ? ReservationSource.WALK_IN : ReservationSource.DIRECT,
      totalAmount: result.reservation.totalAmount.toString(),
      currency: result.reservation.currency,
    });

    if (walkIn) {
      await this.events.publish('reservation.checked_in', ctx, {
        reservationId: result.reservation.id,
        propertyId: result.propertyId,
        code: result.code,
        roomId: '00000000-0000-0000-0000-000000000000',
        checkedInAt:
          result.reservation.checkedInAt?.toISOString() ?? new Date().toISOString(),
      });
    }

    return { id: result.reservation.id, code: result.code };
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async list(
    user: AuthUser,
    correlationId: string,
    query: {
      from?: string;
      to?: string;
      status?: string;
      propertyId?: string;
      cursor?: string;
      limit?: string;
    },
  ): Promise<{ items: ReservationListItem[]; nextCursor: string | null }> {
    const ctx = tenantCtx(user, correlationId);
    const limit = Math.min(Math.max(parseInt(query.limit ?? '50', 10) || 50, 1), 200);

    if (query.from && !ISO_DATE.test(query.from)) {
      throw new BadRequestException('from must be YYYY-MM-DD');
    }
    if (query.to && !ISO_DATE.test(query.to)) {
      throw new BadRequestException('to must be YYYY-MM-DD');
    }
    if (query.status && !(query.status in PrismaReservationStatus)) {
      throw new BadRequestException(`unknown status: ${query.status}`);
    }

    const where: Prisma.ReservationWhereInput = { deletedAt: null };
    if (query.propertyId) where.propertyId = query.propertyId;
    if (query.status) {
      where.status =
        PrismaReservationStatus[query.status as keyof typeof PrismaReservationStatus];
    }
    if (query.from || query.to) {
      where.AND = [];
      if (query.from)
        where.AND.push({ departureDate: { gt: new Date(query.from) } });
      if (query.to)
        where.AND.push({ arrivalDate: { lt: new Date(query.to) } });
    }

    const items = await this.prisma.withTenant(ctx, (tx) =>
      tx.reservation.findMany({
        where,
        orderBy: [{ arrivalDate: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        select: RESERVATION_LIST_SELECT,
      }),
    );

    const nextCursor = items.length > limit ? items[limit]!.id : null;
    return { items: items.slice(0, limit).map(toListItem), nextCursor };
  }

  async findOne(
    user: AuthUser,
    correlationId: string,
    id: string,
  ): Promise<ReservationDetail> {
    const ctx = tenantCtx(user, correlationId);
    const found = await this.prisma.withTenant(ctx, (tx) =>
      tx.reservation.findFirst({
        where: { id, deletedAt: null },
        select: RESERVATION_DETAIL_SELECT,
      }),
    );
    if (!found) throw new NotFoundException(`Reservation ${id} not found`);
    return toDetail(found);
  }

  // -------------------------------------------------------------------------
  // Mutations (cancel + patch). Check-in/out + assign land in W2/W3.
  // -------------------------------------------------------------------------

  async cancel(
    user: AuthUser,
    correlationId: string,
    id: string,
    input: CancelReservationDto,
  ): Promise<{ id: string }> {
    const ctx = tenantCtx(user, correlationId);

    const cancelled = await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.reservation.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, status: true, propertyId: true, code: true },
      });
      if (!existing) {
        throw new NotFoundException(`Reservation ${id} not found`);
      }

      try {
        assertTransition(existing.status, PrismaReservationStatus.CANCELLED);
      } catch (err) {
        if (err instanceof IllegalReservationTransitionError) {
          throw new ConflictException(err.message);
        }
        throw err;
      }

      return tx.reservation.update({
        where: { id: existing.id },
        data: {
          status: PrismaReservationStatus.CANCELLED,
          cancelledAt: new Date(),
          cancellationReason: input.reason,
        },
        select: { id: true, propertyId: true, code: true, cancelledAt: true },
      });
    });

    await this.events.publish('reservation.cancelled', ctx, {
      reservationId: cancelled.id,
      propertyId: cancelled.propertyId,
      code: cancelled.code,
      reason: input.reason,
      policyApplied: input.policyApplied ?? null,
      cancelledAt: cancelled.cancelledAt!.toISOString(),
    });

    return { id: cancelled.id };
  }

  async patch(
    _user: AuthUser,
    _correlationId: string,
    _id: string,
    _input: PatchReservationDto,
  ): Promise<unknown> {
    throw new ForbiddenException('reservations.patch — Sprint 2 W2');
  }

  async checkIn(
    _user: AuthUser,
    _correlationId: string,
    _id: string,
    _input: CheckInDto,
  ): Promise<{ id: string; roomId: string }> {
    throw new ForbiddenException('reservations.checkIn — Sprint 2 W2');
  }

  async checkOut(
    _user: AuthUser,
    _correlationId: string,
    _id: string,
    _input: CheckOutDto,
  ): Promise<{ id: string; balance: number }> {
    throw new ForbiddenException('reservations.checkOut — Sprint 2 W3');
  }

  async assignRoom(
    _user: AuthUser,
    _correlationId: string,
    _id: string,
    _input: AssignRoomDto,
  ): Promise<{ id: string; roomId: string }> {
    throw new ForbiddenException('reservations.assignRoom — Sprint 2 W2');
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

function generateReservationCode(propertyCode: string): string {
  // 6-char base32 random suffix, e.g. BCN-A1B2C3.
  const bytes = randomBytes(4);
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += alphabet[bytes[i % bytes.length]! % alphabet.length];
  }
  return `${propertyCode}-${suffix}`;
}

async function ensureAdHocGuest(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: CreateReservationDto,
): Promise<string> {
  if (!input.guestData) {
    throw new BadRequestException('guestData required when guestId not provided');
  }
  const created = await tx.guest.create({
    data: {
      tenantId,
      firstName: input.guestData.firstName,
      lastName: input.guestData.lastName,
      email: input.guestData.email ?? null,
      phone: input.guestData.phone ?? null,
      nationality: input.guestData.nationality ?? null,
    },
    select: { id: true },
  });
  return created.id;
}

const RESERVATION_LIST_SELECT = {
  id: true,
  code: true,
  status: true,
  arrivalDate: true,
  departureDate: true,
  adults: true,
  children: true,
  roomTypeId: true,
  roomId: true,
  totalAmount: true,
  currency: true,
} as const;

const RESERVATION_DETAIL_SELECT = {
  ...RESERVATION_LIST_SELECT,
  ratePlanId: true,
  source: true,
  specialRequests: true,
  notes: true,
  checkedInAt: true,
  checkedOutAt: true,
  cancelledAt: true,
  cancellationReason: true,
  createdAt: true,
  updatedAt: true,
  propertyId: true,
  guests: {
    select: {
      isPrimary: true,
      guest: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          nationality: true,
        },
      },
    },
  },
  folio: {
    select: {
      id: true,
      status: true,
      balance: true,
      currency: true,
    },
  },
} as const;

type ReservationListRow = Prisma.ReservationGetPayload<{
  select: typeof RESERVATION_LIST_SELECT;
}>;

type ReservationDetailRow = Prisma.ReservationGetPayload<{
  select: typeof RESERVATION_DETAIL_SELECT;
}>;

export interface ReservationListItem {
  id: string;
  code: string;
  status: PrismaReservationStatus;
  arrivalDate: string;
  departureDate: string;
  adults: number;
  children: number;
  roomTypeId: string;
  roomId: string | null;
  totalAmount: string;
  currency: string;
}

export type ReservationDetail = ReservationListItem & {
  ratePlanId: string | null;
  source: ReservationSource;
  specialRequests: string | null;
  notes: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  propertyId: string;
  guests: Array<{
    isPrimary: boolean;
    guest: {
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
      nationality: string | null;
    };
  }>;
  folio: {
    id: string;
    status: string;
    balance: string;
    currency: string;
  } | null;
};

function toListItem(row: ReservationListRow): ReservationListItem {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    arrivalDate: toIsoDate(row.arrivalDate),
    departureDate: toIsoDate(row.departureDate),
    adults: row.adults,
    children: row.children,
    roomTypeId: row.roomTypeId,
    roomId: row.roomId,
    totalAmount: row.totalAmount.toString(),
    currency: row.currency,
  };
}

function toDetail(row: ReservationDetailRow): ReservationDetail {
  return {
    ...toListItem(row),
    ratePlanId: row.ratePlanId,
    source: row.source,
    specialRequests: row.specialRequests,
    notes: row.notes,
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    checkedOutAt: row.checkedOutAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    propertyId: row.propertyId,
    guests: row.guests.map((g) => ({
      isPrimary: g.isPrimary,
      guest: g.guest,
    })),
    folio: row.folio
      ? {
          id: row.folio.id,
          status: row.folio.status,
          balance: row.folio.balance.toString(),
          currency: row.folio.currency,
        }
      : null,
  };
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
