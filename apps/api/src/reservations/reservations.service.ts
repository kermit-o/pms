import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma, ReservationSource, ReservationStatus as PrismaReservationStatus, RoomStatus, HousekeepingTaskStatus, HousekeepingTaskType, GuaranteeType, GuaranteeStatus } from '@pms/db';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';
import type { AuthUser } from '../auth';
import {
  AssignRoomDto,
  CancelReservationDto,
  CheckInDto,
  CheckOutDto,
  CreateReservationDto,
  CreateReservationGroupDto,
  PatchReservationDto,
  PatchReservationGroupDto,
  UpdateGuaranteeDto,
} from './dto';
import { IllegalReservationTransitionError, assertTransition } from './reservation-status';

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
        select: { id: true, defaultRate: true, defaultCurrency: true },
      });
      if (!roomType) {
        throw new BadRequestException(
          `RoomType ${input.roomTypeId} not found for property ${property.id}`,
        );
      }

      let ratePlanAttributes: Prisma.JsonValue | null = null;
      if (input.ratePlanId) {
        const ratePlan = await tx.ratePlan.findFirst({
          where: {
            id: input.ratePlanId,
            propertyId: property.id,
            deletedAt: null,
          },
          select: { id: true, attributes: true },
        });
        if (!ratePlan) {
          throw new BadRequestException(
            `RatePlan ${input.ratePlanId} not found for property ${property.id}`,
          );
        }
        ratePlanAttributes = ratePlan.attributes;
      }

      // Si la API call no pasa totalAmount, lo calculamos: nights × dailyRate.
      // dailyRate viene de RatePlan.attributes.dailyRate (si tiene tarifa
      // declarada) o RoomType.defaultRate como fallback. Misma logica que
      // night-audit/steps/post-room-charges.ts.
      const nights = Math.max(
        1,
        Math.round(
          (new Date(input.departure).getTime() - new Date(input.arrival).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );
      const dailyRate = resolveDailyRateFromInputs(roomType.defaultRate, ratePlanAttributes);
      const computedTotal = dailyRate.mul(nights);
      const effectiveTotal = input.totalAmount
        ? new Prisma.Decimal(input.totalAmount)
        : computedTotal;

      const guestId = input.guestId ?? (await ensureAdHocGuest(tx, user.tenantId, input));

      const code = generateReservationCode(property.code);

      const status: PrismaReservationStatus = walkIn
        ? PrismaReservationStatus.CHECKED_IN
        : PrismaReservationStatus.PENDING;

      const source: ReservationSource = walkIn
        ? ReservationSource.WALK_IN
        : ReservationSource.DIRECT;

      // Garantía: si walk-in, NONE por defecto (el huésped está en mostrador
      // y el pago se cobra en folio). Si reserva remota sin guarantee
      // explícita, marcar PENDING con deadline 2h — operador completa luego.
      const guaranteeInput = input.guarantee;
      const guaranteeType: GuaranteeType = (guaranteeInput?.type as GuaranteeType | undefined) ??
        (walkIn ? GuaranteeType.NONE : GuaranteeType.CARD_ON_FILE);
      const guaranteeStatus: GuaranteeStatus =
        guaranteeType === GuaranteeType.NONE
          ? GuaranteeStatus.RELEASED
          : guaranteeInput?.reference
            ? GuaranteeStatus.SECURED
            : GuaranteeStatus.PENDING;
      const guaranteeDeadline =
        guaranteeStatus === GuaranteeStatus.PENDING
          ? new Date(Date.now() + 2 * 60 * 60 * 1000)
          : null;

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
          totalAmount: effectiveTotal,
          currency: input.currency ?? property.currency,
          source,
          specialRequests: input.specialRequests ?? null,
          notes: input.notes ?? null,
          checkedInAt: walkIn ? new Date() : null,
          guaranteeType,
          guaranteeStatus,
          guaranteeAmount: guaranteeInput?.amount ? new Prisma.Decimal(guaranteeInput.amount) : null,
          guaranteeReference: guaranteeInput?.reference ?? null,
          guaranteeDeadline,
          guaranteeSecuredAt: guaranteeStatus === GuaranteeStatus.SECURED ? new Date() : null,
          cancellationPolicyId: guaranteeInput?.cancellationPolicyId ?? null,
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
        checkedInAt: result.reservation.checkedInAt?.toISOString() ?? new Date().toISOString(),
      });
    }

    return { id: result.reservation.id, code: result.code };
  }

  // -------------------------------------------------------------------------
  // Groups (Sprint 2 W2)
  // -------------------------------------------------------------------------

  async createGroup(
    user: AuthUser,
    correlationId: string,
    input: CreateReservationGroupDto,
  ): Promise<{ groupId: string; code: string; reservationIds: string[] }> {
    const ctx = tenantCtx(user, correlationId);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: input.propertyId, deletedAt: null },
        select: { id: true, code: true, currency: true },
      });
      if (!property) {
        throw new NotFoundException(`Property ${input.propertyId} not found`);
      }

      const groupCode = input.code ?? generateGroupCode(property.code);

      const group = await tx.reservationGroup.create({
        data: {
          tenantId: user.tenantId,
          propertyId: property.id,
          code: groupCode,
          name: input.name,
          organizerName: input.organizerName ?? null,
          organizerEmail: input.organizerEmail ?? null,
          organizerPhone: input.organizerPhone ?? null,
          notes: input.notes ?? null,
        },
        select: { id: true, code: true },
      });

      const reservationIds: string[] = [];

      for (const child of input.reservations) {
        const roomType = await tx.roomType.findFirst({
          where: {
            id: child.roomTypeId,
            propertyId: property.id,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!roomType) {
          throw new BadRequestException(
            `RoomType ${child.roomTypeId} not found for property ${property.id}`,
          );
        }

        if (child.ratePlanId) {
          const ratePlan = await tx.ratePlan.findFirst({
            where: {
              id: child.ratePlanId,
              propertyId: property.id,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!ratePlan) {
            throw new BadRequestException(
              `RatePlan ${child.ratePlanId} not found for property ${property.id}`,
            );
          }
        }

        const guestId =
          child.guestId ??
          (await ensureAdHocGuest(tx, user.tenantId, {
            ...child,
            propertyId: property.id,
          } as CreateReservationDto));

        const code = generateReservationCode(property.code);

        const reservation = await tx.reservation.create({
          data: {
            tenantId: user.tenantId,
            propertyId: property.id,
            code,
            status: PrismaReservationStatus.PENDING,
            arrivalDate: new Date(child.arrival),
            departureDate: new Date(child.departure),
            adults: child.occupancy.adults,
            children: child.occupancy.children,
            roomTypeId: child.roomTypeId,
            ratePlanId: child.ratePlanId ?? null,
            totalAmount: new Prisma.Decimal(child.totalAmount ?? 0),
            currency: child.currency ?? property.currency,
            source: ReservationSource.DIRECT,
            specialRequests: child.specialRequests ?? null,
            notes: child.notes ?? null,
            groupId: group.id,
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
                currency: child.currency ?? property.currency,
              },
            },
          },
          select: { id: true },
        });

        reservationIds.push(reservation.id);
      }

      return {
        group,
        propertyId: property.id,
        reservationIds,
      };
    });

    await this.events.publish('reservation.group_created', ctx, {
      groupId: result.group.id,
      propertyId: result.propertyId,
      code: result.group.code,
      name: input.name,
      reservationIds: result.reservationIds,
    });

    return {
      groupId: result.group.id,
      code: result.group.code,
      reservationIds: result.reservationIds,
    };
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
      where.status = PrismaReservationStatus[query.status as keyof typeof PrismaReservationStatus];
    }
    if (query.from || query.to) {
      where.AND = [];
      if (query.from) where.AND.push({ departureDate: { gt: new Date(query.from) } });
      if (query.to) where.AND.push({ arrivalDate: { lt: new Date(query.to) } });
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

  async findOne(user: AuthUser, correlationId: string, id: string): Promise<ReservationDetail> {
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
    user: AuthUser,
    correlationId: string,
    id: string,
    input: PatchReservationDto,
  ): Promise<{ id: string }> {
    const ctx = tenantCtx(user, correlationId);

    if (
      input.arrival === undefined &&
      input.departure === undefined &&
      input.roomTypeId === undefined &&
      input.ratePlanId === undefined &&
      input.occupancy === undefined &&
      input.notes === undefined
    ) {
      throw new BadRequestException('no fields to update');
    }

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.reservation.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          status: true,
          propertyId: true,
          code: true,
          arrivalDate: true,
          departureDate: true,
          roomTypeId: true,
          ratePlanId: true,
          adults: true,
          children: true,
          notes: true,
        },
      });
      if (!existing) {
        throw new NotFoundException(`Reservation ${id} not found`);
      }
      if (
        existing.status === PrismaReservationStatus.CANCELLED ||
        existing.status === PrismaReservationStatus.CHECKED_OUT ||
        existing.status === PrismaReservationStatus.NO_SHOW
      ) {
        throw new ConflictException(
          `Reservation in terminal status ${existing.status} cannot be patched`,
        );
      }

      const newArrival = input.arrival ? new Date(input.arrival) : existing.arrivalDate;
      const newDeparture = input.departure ? new Date(input.departure) : existing.departureDate;
      if (newDeparture <= newArrival) {
        throw new BadRequestException('departure must be after arrival');
      }

      if (input.roomTypeId !== undefined && input.roomTypeId !== existing.roomTypeId) {
        const rt = await tx.roomType.findFirst({
          where: {
            id: input.roomTypeId,
            propertyId: existing.propertyId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!rt) {
          throw new BadRequestException(`RoomType ${input.roomTypeId} not found in property`);
        }
      }

      if (input.ratePlanId !== undefined && input.ratePlanId !== existing.ratePlanId) {
        const rp = await tx.ratePlan.findFirst({
          where: {
            id: input.ratePlanId,
            propertyId: existing.propertyId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!rp) {
          throw new BadRequestException(`RatePlan ${input.ratePlanId} not found in property`);
        }
      }

      const updated = await tx.reservation.update({
        where: { id: existing.id },
        data: {
          ...(input.arrival ? { arrivalDate: newArrival } : {}),
          ...(input.departure ? { departureDate: newDeparture } : {}),
          ...(input.roomTypeId !== undefined ? { roomTypeId: input.roomTypeId } : {}),
          ...(input.ratePlanId !== undefined ? { ratePlanId: input.ratePlanId } : {}),
          ...(input.occupancy
            ? {
                adults: input.occupancy.adults,
                children: input.occupancy.children,
              }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
        select: { id: true, propertyId: true, code: true },
      });

      const changes: Record<string, unknown> = {};
      if (input.arrival) changes.arrivalDate = input.arrival;
      if (input.departure) changes.departureDate = input.departure;
      if (input.roomTypeId !== undefined) changes.roomTypeId = input.roomTypeId;
      if (input.ratePlanId !== undefined) changes.ratePlanId = input.ratePlanId;
      if (input.occupancy) changes.occupancy = input.occupancy;
      if (input.notes !== undefined) changes.notes = input.notes;

      return { updated, changes };
    });

    await this.events.publish('reservation.updated', ctx, {
      reservationId: result.updated.id,
      propertyId: result.updated.propertyId,
      code: result.updated.code,
      changes: result.changes,
    });

    return { id: result.updated.id };
  }

  async checkIn(
    user: AuthUser,
    correlationId: string,
    id: string,
    input: CheckInDto,
  ): Promise<{ id: string; roomId: string }> {
    const ctx = tenantCtx(user, correlationId);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.reservation.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          status: true,
          propertyId: true,
          code: true,
          roomId: true,
          roomTypeId: true,
        },
      });
      if (!existing) {
        throw new NotFoundException(`Reservation ${id} not found`);
      }

      try {
        assertTransition(existing.status, PrismaReservationStatus.CHECKED_IN);
      } catch (err) {
        if (err instanceof IllegalReservationTransitionError) {
          throw new ConflictException(err.message);
        }
        throw err;
      }

      const targetRoomId = input.roomId ?? existing.roomId;
      if (!targetRoomId) {
        throw new BadRequestException('roomId required: reservation has no assigned room');
      }

      const room = await tx.room.findFirst({
        where: {
          id: targetRoomId,
          propertyId: existing.propertyId,
          roomTypeId: existing.roomTypeId,
          deletedAt: null,
        },
        select: { id: true, isOutOfOrder: true },
      });
      if (!room) {
        throw new BadRequestException(`Room ${targetRoomId} not available for this reservation`);
      }
      if (room.isOutOfOrder) {
        throw new ConflictException(`Room ${targetRoomId} is out of order`);
      }

      const checkedInAt = new Date();
      const updated = await tx.reservation.update({
        where: { id: existing.id },
        data: {
          status: PrismaReservationStatus.CHECKED_IN,
          checkedInAt,
          roomId: room.id,
        },
        select: { id: true, propertyId: true, code: true },
      });

      return { updated, roomId: room.id, checkedInAt };
    });

    await this.events.publish('reservation.checked_in', ctx, {
      reservationId: result.updated.id,
      propertyId: result.updated.propertyId,
      code: result.updated.code,
      roomId: result.roomId,
      checkedInAt: result.checkedInAt.toISOString(),
    });

    return { id: result.updated.id, roomId: result.roomId };
  }

  async checkOut(
    user: AuthUser,
    correlationId: string,
    id: string,
    _input: CheckOutDto,
  ): Promise<{ id: string; balance: number }> {
    const ctx = tenantCtx(user, correlationId);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.reservation.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          status: true,
          propertyId: true,
          code: true,
          roomId: true,
          folio: { select: { id: true, balance: true } },
        },
      });
      if (!existing) {
        throw new NotFoundException(`Reservation ${id} not found`);
      }

      try {
        assertTransition(existing.status, PrismaReservationStatus.CHECKED_OUT);
      } catch (err) {
        if (err instanceof IllegalReservationTransitionError) {
          throw new ConflictException(err.message);
        }
        throw err;
      }

      if (!existing.roomId) {
        throw new BadRequestException('cannot check out: reservation has no assigned room');
      }

      const checkedOutAt = new Date();
      const businessDate = new Date(checkedOutAt.toISOString().slice(0, 10));

      const updated = await tx.reservation.update({
        where: { id: existing.id },
        data: {
          status: PrismaReservationStatus.CHECKED_OUT,
          checkedOutAt,
        },
        select: { id: true, propertyId: true, code: true },
      });

      // Habitacion -> DIRTY (la HSK la pasa a CLEAN al completar la tarea)
      await tx.room.update({
        where: { id: existing.roomId },
        data: { status: RoomStatus.DIRTY },
      });

      // Tarea HSK CHECKOUT_CLEAN. La unique (propertyId, businessDate, roomId,
      // taskType) garantiza idempotencia si se llama dos veces el mismo dia.
      await tx.housekeepingTask.upsert({
        where: {
          propertyId_businessDate_roomId_taskType: {
            propertyId: existing.propertyId,
            businessDate,
            roomId: existing.roomId,
            taskType: HousekeepingTaskType.CHECKOUT_CLEAN,
          },
        },
        update: {},
        create: {
          tenantId: user.tenantId,
          propertyId: existing.propertyId,
          roomId: existing.roomId,
          taskType: HousekeepingTaskType.CHECKOUT_CLEAN,
          status: HousekeepingTaskStatus.PENDING,
          businessDate,
          scheduledFor: new Date(checkedOutAt.getTime() + 30 * 60_000),
        },
      });

      const balance = existing.folio?.balance
        ? Number(existing.folio.balance.toString())
        : 0;

      return { updated, roomId: existing.roomId, checkedOutAt, balance };
    });

    await this.events.publish('reservation.checked_out', ctx, {
      reservationId: result.updated.id,
      propertyId: result.updated.propertyId,
      code: result.updated.code,
      checkedOutAt: result.checkedOutAt.toISOString(),
      finalBalance: result.balance.toFixed(2),
    });

    return { id: result.updated.id, balance: result.balance };
  }

  async assignRoom(
    user: AuthUser,
    correlationId: string,
    id: string,
    input: AssignRoomDto,
  ): Promise<{ id: string; roomId: string }> {
    const ctx = tenantCtx(user, correlationId);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.reservation.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          status: true,
          propertyId: true,
          code: true,
          roomId: true,
          roomTypeId: true,
        },
      });
      if (!existing) {
        throw new NotFoundException(`Reservation ${id} not found`);
      }
      if (
        existing.status === PrismaReservationStatus.CANCELLED ||
        existing.status === PrismaReservationStatus.CHECKED_OUT ||
        existing.status === PrismaReservationStatus.NO_SHOW
      ) {
        throw new ConflictException(
          `Reservation in status ${existing.status} cannot have a room assigned`,
        );
      }

      const room = await tx.room.findFirst({
        where: {
          id: input.roomId,
          propertyId: existing.propertyId,
          roomTypeId: existing.roomTypeId,
          deletedAt: null,
        },
        select: { id: true, isOutOfOrder: true },
      });
      if (!room) {
        throw new BadRequestException(`Room ${input.roomId} not found or wrong room type`);
      }
      if (room.isOutOfOrder) {
        throw new ConflictException(`Room ${input.roomId} is out of order`);
      }

      const updated = await tx.reservation.update({
        where: { id: existing.id },
        data: { roomId: room.id },
        select: { id: true, propertyId: true, code: true },
      });

      return {
        updated,
        roomId: room.id,
        previousRoomId: existing.roomId,
      };
    });

    await this.events.publish('reservation.room_assigned', ctx, {
      reservationId: result.updated.id,
      propertyId: result.updated.propertyId,
      code: result.updated.code,
      roomId: result.roomId,
      previousRoomId: result.previousRoomId,
      assignedAt: new Date().toISOString(),
    });

    return { id: result.updated.id, roomId: result.roomId };
  }

  async updateGuarantee(
    user: AuthUser,
    correlationId: string,
    id: string,
    input: UpdateGuaranteeDto,
  ): Promise<{ id: string; guaranteeStatus: GuaranteeStatus; guaranteeType: GuaranteeType }> {
    const ctx = tenantCtx(user, correlationId);
    return this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.reservation.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, guaranteeType: true, guaranteeStatus: true },
      });
      if (!existing) throw new NotFoundException(`Reservation ${id} not found`);

      const nextType = (input.type as GuaranteeType | undefined) ?? existing.guaranteeType;
      const nextStatus = (input.status as GuaranteeStatus | undefined) ?? existing.guaranteeStatus;

      const updated = await tx.reservation.update({
        where: { id },
        data: {
          guaranteeType: nextType,
          guaranteeStatus: nextStatus,
          guaranteeAmount:
            input.amount !== undefined ? new Prisma.Decimal(input.amount) : undefined,
          guaranteeReference: input.reference ?? undefined,
          guaranteeSecuredAt:
            nextStatus === GuaranteeStatus.SECURED ? new Date() : undefined,
          guaranteeDeadline:
            nextStatus === GuaranteeStatus.SECURED || nextStatus === GuaranteeStatus.RELEASED
              ? null
              : undefined,
        },
        select: { id: true, guaranteeStatus: true, guaranteeType: true },
      });

      return updated;
    });
  }

  // ===========================================================================
  // GROUP OPERATIONS
  // ===========================================================================

  /** Detalle de un grupo con todas sus reservas hijas. */
  async findGroup(user: AuthUser, correlationId: string, id: string) {
    const ctx = tenantCtx(user, correlationId);
    return this.prisma.withTenant(ctx, async (tx) => {
      const grp = await tx.reservationGroup.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          code: true,
          name: true,
          organizerName: true,
          organizerEmail: true,
          organizerPhone: true,
          notes: true,
          propertyId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!grp) throw new NotFoundException(`Group ${id} not found`);

      const items = await tx.reservation.findMany({
        where: { groupId: id, deletedAt: null },
        orderBy: [{ arrivalDate: 'asc' }, { code: 'asc' }],
        select: {
          ...RESERVATION_LIST_SELECT,
          room: { select: { number: true, floor: true } },
        },
      });

      return {
        ...grp,
        reservations: items.map((r) => ({
          ...toListItem(r),
          roomNumber: r.room?.number ?? null,
          roomFloor: r.room?.floor ?? null,
        })),
      };
    });
  }

  /**
   * Patch a nivel grupo. Campos del grupo (name, organizer*, notes) actualizan
   * solo el grupo. Campos de estancia (arrival, departure, roomTypeId,
   * ratePlanId) hacen cascade a TODAS las reservas hijas que no esten en
   * estado terminal (CHECKED_OUT, CANCELLED, NO_SHOW). Lo que no se especifica
   * se mantiene por reserva — la edicion linea-a-linea sigue valida.
   */
  async patchGroup(
    user: AuthUser,
    correlationId: string,
    id: string,
    input: PatchReservationGroupDto,
  ): Promise<{ id: string; affectedReservations: number }> {
    const ctx = tenantCtx(user, correlationId);
    return this.prisma.withTenant(ctx, async (tx) => {
      const grp = await tx.reservationGroup.findFirst({
        where: { id, deletedAt: null },
        select: { id: true },
      });
      if (!grp) throw new NotFoundException(`Group ${id} not found`);

      // 1. Update group-level fields
      await tx.reservationGroup.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.organizerName !== undefined ? { organizerName: input.organizerName } : {}),
          ...(input.organizerEmail !== undefined ? { organizerEmail: input.organizerEmail } : {}),
          ...(input.organizerPhone !== undefined ? { organizerPhone: input.organizerPhone } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });

      // 2. Cascade fields a las reservas hijas no-terminales
      const cascadeData: Record<string, unknown> = {};
      if (input.arrival !== undefined) cascadeData.arrivalDate = new Date(input.arrival);
      if (input.departure !== undefined) cascadeData.departureDate = new Date(input.departure);
      if (input.roomTypeId !== undefined) cascadeData.roomTypeId = input.roomTypeId;
      if (input.ratePlanId !== undefined) cascadeData.ratePlanId = input.ratePlanId;

      let affected = 0;
      if (Object.keys(cascadeData).length > 0) {
        const result = await tx.reservation.updateMany({
          where: {
            groupId: id,
            deletedAt: null,
            status: {
              notIn: [
                PrismaReservationStatus.CHECKED_OUT,
                PrismaReservationStatus.CANCELLED,
                PrismaReservationStatus.NO_SHOW,
              ],
            },
          },
          data: cascadeData,
        });
        affected = result.count;
      }

      return { id, affectedReservations: affected };
    });
  }

  /** Cancela TODAS las reservas no-terminales del grupo en una transaccion. */
  async cancelGroup(
    user: AuthUser,
    correlationId: string,
    id: string,
    input: CancelReservationDto,
  ): Promise<{ id: string; cancelledReservations: number }> {
    const ctx = tenantCtx(user, correlationId);
    return this.prisma.withTenant(ctx, async (tx) => {
      const grp = await tx.reservationGroup.findFirst({
        where: { id, deletedAt: null },
        select: { id: true },
      });
      if (!grp) throw new NotFoundException(`Group ${id} not found`);

      const cancelledAt = new Date();
      const result = await tx.reservation.updateMany({
        where: {
          groupId: id,
          deletedAt: null,
          status: {
            notIn: [
              PrismaReservationStatus.CHECKED_OUT,
              PrismaReservationStatus.CANCELLED,
              PrismaReservationStatus.NO_SHOW,
            ],
          },
        },
        data: {
          status: PrismaReservationStatus.CANCELLED,
          cancelledAt,
          cancellationReason: input.reason,
        },
      });

      return { id, cancelledReservations: result.count };
    });
  }

  /**
   * Asigna habitaciones libres del tipo correcto a CADA reserva no-terminal
   * sin roomId del grupo. No reasigna las que ya tienen room.
   */
  async bulkAssignRooms(
    user: AuthUser,
    correlationId: string,
    id: string,
  ): Promise<{ id: string; assignedCount: number; missingByType: Record<string, number> }> {
    const ctx = tenantCtx(user, correlationId);
    return this.prisma.withTenant(ctx, async (tx) => {
      const grp = await tx.reservationGroup.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, propertyId: true },
      });
      if (!grp) throw new NotFoundException(`Group ${id} not found`);

      const pending = await tx.reservation.findMany({
        where: {
          groupId: id,
          deletedAt: null,
          roomId: null,
          status: {
            notIn: [
              PrismaReservationStatus.CHECKED_OUT,
              PrismaReservationStatus.CANCELLED,
              PrismaReservationStatus.NO_SHOW,
            ],
          },
        },
        select: { id: true, roomTypeId: true, arrivalDate: true, departureDate: true },
      });

      const allRooms = await tx.room.findMany({
        where: { propertyId: grp.propertyId, deletedAt: null, isOutOfOrder: false },
        select: { id: true, roomTypeId: true },
      });

      // Habitaciones ocupadas en cualquier rango que solape con cada reserva
      // pending. Para simplificar, una pasada que coge cualquier reserva
      // overlapping en el rango completo del grupo.
      const groupRange = pending.reduce(
        (acc, r) => ({
          minArrival: !acc.minArrival || r.arrivalDate < acc.minArrival ? r.arrivalDate : acc.minArrival,
          maxDeparture: !acc.maxDeparture || r.departureDate > acc.maxDeparture ? r.departureDate : acc.maxDeparture,
        }),
        { minArrival: undefined as Date | undefined, maxDeparture: undefined as Date | undefined },
      );

      const conflicting = await tx.reservation.findMany({
        where: {
          propertyId: grp.propertyId,
          deletedAt: null,
          NOT: { roomId: null },
          status: {
            in: [
              PrismaReservationStatus.PENDING,
              PrismaReservationStatus.CONFIRMED,
              PrismaReservationStatus.CHECKED_IN,
            ],
          },
          ...(groupRange.minArrival && groupRange.maxDeparture
            ? {
                arrivalDate: { lt: groupRange.maxDeparture },
                departureDate: { gt: groupRange.minArrival },
              }
            : {}),
        },
        select: { roomId: true },
      });
      const taken = new Set(conflicting.map((r) => r.roomId).filter(Boolean) as string[]);

      const missingByType: Record<string, number> = {};
      let assignedCount = 0;

      for (const reservation of pending) {
        const candidate = allRooms.find(
          (r) => r.roomTypeId === reservation.roomTypeId && !taken.has(r.id),
        );
        if (!candidate) {
          missingByType[reservation.roomTypeId] = (missingByType[reservation.roomTypeId] ?? 0) + 1;
          continue;
        }
        await tx.reservation.update({
          where: { id: reservation.id },
          data: { roomId: candidate.id },
        });
        taken.add(candidate.id);
        assignedCount += 1;
      }

      return { id, assignedCount, missingByType };
    });
  }

  /**
   * Check-in masivo: para cada reserva PENDING/CONFIRMED del grupo, transita
   * a CHECKED_IN. Si la reserva no tiene roomId, falla solo esa (el resto
   * se procesan). El operador debe correr bulkAssignRooms antes.
   */
  async bulkCheckIn(
    user: AuthUser,
    correlationId: string,
    id: string,
  ): Promise<{ id: string; checkedIn: number; skipped: Array<{ id: string; reason: string }> }> {
    const ctx = tenantCtx(user, correlationId);
    return this.prisma.withTenant(ctx, async (tx) => {
      const grp = await tx.reservationGroup.findFirst({
        where: { id, deletedAt: null },
        select: { id: true },
      });
      if (!grp) throw new NotFoundException(`Group ${id} not found`);

      const items = await tx.reservation.findMany({
        where: {
          groupId: id,
          deletedAt: null,
          status: {
            in: [PrismaReservationStatus.PENDING, PrismaReservationStatus.CONFIRMED],
          },
        },
        select: { id: true, roomId: true, code: true },
      });

      const skipped: Array<{ id: string; reason: string }> = [];
      let checkedIn = 0;
      const now = new Date();

      for (const r of items) {
        if (!r.roomId) {
          skipped.push({ id: r.id, reason: 'no roomId — corre bulkAssignRooms primero' });
          continue;
        }
        await tx.reservation.update({
          where: { id: r.id },
          data: { status: PrismaReservationStatus.CHECKED_IN, checkedInAt: now },
        });
        checkedIn += 1;
      }

      return { id, checkedIn, skipped };
    });
  }

  /**
   * Check-out masivo: para cada reserva CHECKED_IN del grupo, transita a
   * CHECKED_OUT, marca room DIRTY, crea tarea HSK CHECKOUT_CLEAN (upsert
   * por unique).
   */
  async bulkCheckOut(
    user: AuthUser,
    correlationId: string,
    id: string,
  ): Promise<{ id: string; checkedOut: number; skipped: Array<{ id: string; reason: string }> }> {
    const ctx = tenantCtx(user, correlationId);
    return this.prisma.withTenant(ctx, async (tx) => {
      const grp = await tx.reservationGroup.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, propertyId: true },
      });
      if (!grp) throw new NotFoundException(`Group ${id} not found`);

      const items = await tx.reservation.findMany({
        where: {
          groupId: id,
          deletedAt: null,
          status: PrismaReservationStatus.CHECKED_IN,
        },
        select: { id: true, roomId: true, code: true },
      });

      const skipped: Array<{ id: string; reason: string }> = [];
      let checkedOut = 0;
      const now = new Date();
      const businessDate = new Date(now.toISOString().slice(0, 10));

      for (const r of items) {
        if (!r.roomId) {
          skipped.push({ id: r.id, reason: 'no roomId' });
          continue;
        }
        await tx.reservation.update({
          where: { id: r.id },
          data: { status: PrismaReservationStatus.CHECKED_OUT, checkedOutAt: now },
        });
        await tx.room.update({
          where: { id: r.roomId },
          data: { status: RoomStatus.DIRTY },
        });
        await tx.housekeepingTask.upsert({
          where: {
            propertyId_businessDate_roomId_taskType: {
              propertyId: grp.propertyId,
              businessDate,
              roomId: r.roomId,
              taskType: HousekeepingTaskType.CHECKOUT_CLEAN,
            },
          },
          update: {},
          create: {
            tenantId: user.tenantId,
            propertyId: grp.propertyId,
            roomId: r.roomId,
            taskType: HousekeepingTaskType.CHECKOUT_CLEAN,
            status: HousekeepingTaskStatus.PENDING,
            businessDate,
            scheduledFor: new Date(now.getTime() + 30 * 60_000),
          },
        });
        checkedOut += 1;
      }

      return { id, checkedOut, skipped };
    });
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

function generateGroupCode(propertyCode: string): string {
  const bytes = randomBytes(3);
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += alphabet[bytes[i % bytes.length]! % alphabet.length];
  }
  return `GRP-${propertyCode}-${suffix}`;
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
  guaranteeType: true,
  guaranteeStatus: true,
  guaranteeAmount: true,
  guaranteeReference: true,
  guaranteeDeadline: true,
  guaranteeSecuredAt: true,
  cancellationPolicyId: true,
  groupId: true,
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
  guaranteeType: GuaranteeType;
  guaranteeStatus: GuaranteeStatus;
  guaranteeAmount: string | null;
  guaranteeReference: string | null;
  guaranteeDeadline: string | null;
  guaranteeSecuredAt: string | null;
  cancellationPolicyId: string | null;
  groupId: string | null;
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
    guaranteeType: row.guaranteeType,
    guaranteeStatus: row.guaranteeStatus,
    guaranteeAmount: row.guaranteeAmount?.toString() ?? null,
    guaranteeReference: row.guaranteeReference,
    guaranteeDeadline: row.guaranteeDeadline?.toISOString() ?? null,
    guaranteeSecuredAt: row.guaranteeSecuredAt?.toISOString() ?? null,
    cancellationPolicyId: row.cancellationPolicyId,
    groupId: row.groupId,
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

// Resuelve la tarifa diaria: RatePlan.attributes.dailyRate > RoomType.defaultRate.
// Mismo contrato que apps/api/src/night-audit/steps/post-room-charges.ts
// resolveDailyRate — extraido aqui para usar en create().
function resolveDailyRateFromInputs(
  roomTypeDefaultRate: Prisma.Decimal,
  ratePlanAttributes: Prisma.JsonValue | null,
): Prisma.Decimal {
  if (
    ratePlanAttributes &&
    typeof ratePlanAttributes === 'object' &&
    !Array.isArray(ratePlanAttributes) &&
    'dailyRate' in ratePlanAttributes
  ) {
    const raw = (ratePlanAttributes as Record<string, unknown>).dailyRate;
    if (typeof raw === 'number' || typeof raw === 'string') {
      try {
        return new Prisma.Decimal(raw);
      } catch {
        // fall through
      }
    }
  }
  return new Prisma.Decimal(roomTypeDefaultRate);
}
