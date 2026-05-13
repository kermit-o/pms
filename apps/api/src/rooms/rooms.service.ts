import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ReservationStatus, RoomStatus } from '@pms/db';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';
import type { AuthUser } from '../auth';
import {
  AvailabilityQuery,
  ChangeStatusDto,
  ListRoomsQuery,
  SearchAvailabilityByTypeQuery,
  SearchAvailabilityQuery,
} from './dto';

@Injectable()
export class RoomsService {
  private readonly log = new Logger(RoomsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventbusService,
  ) {}

  async list(
    user: AuthUser,
    correlationId: string,
    query: ListRoomsQuery,
  ): Promise<RoomListItem[]> {
    const ctx = tenantCtx(user, correlationId);
    const where: Prisma.RoomWhereInput = { deletedAt: null };
    if (query.propertyId) where.propertyId = query.propertyId;
    if (query.roomTypeId) where.roomTypeId = query.roomTypeId;
    if (query.status) where.status = RoomStatus[query.status as keyof typeof RoomStatus];
    if (query.floor) where.floor = query.floor;

    const rows = await this.prisma.withTenant(ctx, (tx) =>
      tx.room.findMany({
        where,
        orderBy: [{ floor: 'asc' }, { number: 'asc' }],
        select: ROOM_LIST_SELECT,
      }),
    );
    return rows.map(toRoomListItem);
  }

  /**
   * Builds a (room x date) availability matrix for the given window.
   *
   * Each cell is one of:
   *  - 'OOO'  if the room is out of order
   *  - 'OCC'  if a reservation overlaps the date
   *  - room status (CLEAN/DIRTY/...) otherwise.
   *
   * The window is half-open `[from, to)`, expressed as YYYY-MM-DD strings.
   */
  async availability(
    user: AuthUser,
    correlationId: string,
    query: AvailabilityQuery,
  ): Promise<AvailabilityMatrix> {
    if (query.from >= query.to) {
      throw new BadRequestException('from must be before to');
    }
    const ctx = tenantCtx(user, correlationId);
    const fromDate = new Date(query.from);
    const toDate = new Date(query.to);

    return this.prisma.withTenant(ctx, async (tx) => {
      const rooms = await tx.room.findMany({
        where: {
          deletedAt: null,
          propertyId: query.propertyId,
          ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
        },
        orderBy: [{ floor: 'asc' }, { number: 'asc' }],
        select: ROOM_LIST_SELECT,
      });

      const reservations = await tx.reservation.findMany({
        where: {
          deletedAt: null,
          propertyId: query.propertyId,
          ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
          status: {
            in: [
              ReservationStatus.PENDING,
              ReservationStatus.CONFIRMED,
              ReservationStatus.CHECKED_IN,
            ],
          },
          arrivalDate: { lt: toDate },
          departureDate: { gt: fromDate },
        },
        select: {
          id: true,
          code: true,
          status: true,
          roomId: true,
          arrivalDate: true,
          departureDate: true,
        },
      });

      const days: string[] = [];
      for (let d = new Date(fromDate); d < toDate; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().slice(0, 10));
      }

      const cells: Record<string, Record<string, AvailabilityCell>> = {};
      for (const room of rooms) {
        const row: Record<string, AvailabilityCell> = {};
        for (const day of days) {
          row[day] = {
            state: room.isOutOfOrder ? 'OOO' : (room.status as string),
            reservation: null,
          };
        }
        cells[room.id] = row;
      }

      for (const r of reservations) {
        if (!r.roomId || !cells[r.roomId]) continue;
        const arr = r.arrivalDate.toISOString().slice(0, 10);
        const dep = r.departureDate.toISOString().slice(0, 10);
        for (const day of days) {
          if (day < arr || day >= dep) continue;
          const cell = cells[r.roomId]![day];
          if (!cell || cell.state === 'OOO') continue;
          cell.state = 'OCC';
          cell.reservation = {
            id: r.id,
            code: r.code,
            status: r.status,
            arrivalDate: arr,
            departureDate: dep,
          };
        }
      }

      return {
        from: query.from,
        to: query.to,
        days,
        rooms: rooms.map(toRoomListItem),
        cells,
      };
    });
  }

  async searchAvailability(
    user: AuthUser,
    correlationId: string,
    query: SearchAvailabilityQuery,
  ): Promise<RoomListItem[]> {
    if (query.arrival >= query.departure) {
      throw new BadRequestException('arrival must be before departure');
    }
    const ctx = tenantCtx(user, correlationId);
    const arrival = new Date(query.arrival);
    const departure = new Date(query.departure);

    return this.prisma.withTenant(ctx, async (tx) => {
      const candidates = await tx.room.findMany({
        where: {
          deletedAt: null,
          propertyId: query.propertyId,
          roomTypeId: query.roomTypeId,
          isOutOfOrder: false,
        },
        select: ROOM_LIST_SELECT,
      });

      const overlapping = await tx.reservation.findMany({
        where: {
          deletedAt: null,
          propertyId: query.propertyId,
          status: {
            in: [
              ReservationStatus.PENDING,
              ReservationStatus.CONFIRMED,
              ReservationStatus.CHECKED_IN,
            ],
          },
          arrivalDate: { lt: departure },
          departureDate: { gt: arrival },
          NOT: { roomId: null },
        },
        select: { roomId: true },
      });
      const taken = new Set(overlapping.map((r) => r.roomId).filter((id): id is string => !!id));

      return candidates.filter((r) => !taken.has(r.id)).map(toRoomListItem);
    });
  }

  /**
   * Resumen agregado por roomType para un rango [arrival, departure).
   * Devuelve cada tipo con: rooms libres, total operativos, precio/noche y
   * total de la estancia. Esto alimenta el wizard de creación de reservas.
   *
   * Precio: si se pasa ratePlanId con attributes.dailyRate, se usa eso;
   * si no, RoomType.defaultRate. Mismo contrato que post-room-charges y
   * createReservation.
   */
  async searchAvailabilityByType(
    user: AuthUser,
    correlationId: string,
    query: SearchAvailabilityByTypeQuery,
  ): Promise<RoomTypeAvailability[]> {
    if (query.arrival >= query.departure) {
      throw new BadRequestException('arrival must be before departure');
    }
    const ctx = tenantCtx(user, correlationId);
    const arrival = new Date(query.arrival);
    const departure = new Date(query.departure);
    const nights = Math.max(
      1,
      Math.round((departure.getTime() - arrival.getTime()) / (1000 * 60 * 60 * 24)),
    );

    return this.prisma.withTenant(ctx, async (tx) => {
      const ratePlanAttrs = query.ratePlanId
        ? await tx.ratePlan
            .findFirst({
              where: { id: query.ratePlanId, propertyId: query.propertyId, deletedAt: null },
              select: { attributes: true },
            })
            .then((rp) => rp?.attributes ?? null)
        : null;

      const types = await tx.roomType.findMany({
        where: { propertyId: query.propertyId, deletedAt: null },
        orderBy: { defaultRate: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          baseOccupancy: true,
          maxOccupancy: true,
          defaultRate: true,
          defaultCurrency: true,
        },
      });

      const rooms = await tx.room.findMany({
        where: {
          propertyId: query.propertyId,
          deletedAt: null,
          isOutOfOrder: false,
        },
        select: { id: true, roomTypeId: true },
      });

      const overlapping = await tx.reservation.findMany({
        where: {
          deletedAt: null,
          propertyId: query.propertyId,
          status: {
            in: [
              ReservationStatus.PENDING,
              ReservationStatus.CONFIRMED,
              ReservationStatus.CHECKED_IN,
            ],
          },
          arrivalDate: { lt: departure },
          departureDate: { gt: arrival },
        },
        select: { roomId: true, roomTypeId: true },
      });

      const takenRoomIds = new Set(
        overlapping.map((r) => r.roomId).filter((id): id is string => !!id),
      );
      // Reservas SIN room asignada (PENDING/walk-in pre-asignación) cuentan
      // como ocupación pendiente para su roomType.
      const unassignedByType = new Map<string, number>();
      for (const r of overlapping) {
        if (!r.roomId) {
          unassignedByType.set(r.roomTypeId, (unassignedByType.get(r.roomTypeId) ?? 0) + 1);
        }
      }

      return types.map<RoomTypeAvailability>((rt) => {
        const total = rooms.filter((r) => r.roomTypeId === rt.id).length;
        const occupiedAssigned = rooms.filter(
          (r) => r.roomTypeId === rt.id && takenRoomIds.has(r.id),
        ).length;
        const occupiedUnassigned = unassignedByType.get(rt.id) ?? 0;
        const available = Math.max(0, total - occupiedAssigned - occupiedUnassigned);
        const dailyRate = resolveDailyRateAttrs(rt.defaultRate, ratePlanAttrs);
        const total_ = dailyRate.mul(nights);
        return {
          roomTypeId: rt.id,
          code: rt.code,
          name: rt.name,
          description: rt.description,
          baseOccupancy: rt.baseOccupancy,
          maxOccupancy: rt.maxOccupancy,
          totalRooms: total,
          availableRooms: available,
          pricePerNight: dailyRate.toString(),
          nights,
          totalForStay: total_.toString(),
          currency: rt.defaultCurrency,
        };
      });
    });
  }

  async changeStatus(
    user: AuthUser,
    correlationId: string,
    id: string,
    input: ChangeStatusDto,
  ): Promise<{ id: string; status: string }> {
    const ctx = tenantCtx(user, correlationId);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.room.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          status: true,
          number: true,
          propertyId: true,
          isOutOfOrder: true,
        },
      });
      if (!existing) throw new NotFoundException(`Room ${id} not found`);

      const isOutOfOrder = input.status === 'OUT_OF_ORDER';
      const updated = await tx.room.update({
        where: { id },
        data: {
          status: RoomStatus[input.status as keyof typeof RoomStatus],
          isOutOfOrder,
          outOfOrderReason: isOutOfOrder ? (input.outOfOrderReason ?? null) : null,
        },
        select: { id: true, status: true, number: true, propertyId: true },
      });
      return { previous: existing, updated, isOutOfOrder };
    });

    await this.events.publish('room.status_changed', ctx, {
      roomId: result.updated.id,
      propertyId: result.updated.propertyId,
      number: result.updated.number,
      previousStatus: result.previous.status,
      newStatus: result.updated.status,
      isOutOfOrder: result.isOutOfOrder,
      changedAt: new Date().toISOString(),
    });

    return { id: result.updated.id, status: result.updated.status };
  }
}

// ---------------------------------------------------------------------------
// Helpers / types
// ---------------------------------------------------------------------------

function tenantCtx(user: AuthUser, correlationId: string) {
  return {
    tenantId: user.tenantId,
    actorId: user.sub,
    correlationId,
  };
}

const ROOM_LIST_SELECT = {
  id: true,
  number: true,
  floor: true,
  status: true,
  isOutOfOrder: true,
  outOfOrderReason: true,
  roomTypeId: true,
  propertyId: true,
} as const;

type RoomRow = Prisma.RoomGetPayload<{ select: typeof ROOM_LIST_SELECT }>;

export interface RoomListItem {
  id: string;
  number: string;
  floor: string | null;
  status: string;
  isOutOfOrder: boolean;
  outOfOrderReason: string | null;
  roomTypeId: string;
  propertyId: string;
}

function toRoomListItem(row: RoomRow): RoomListItem {
  return {
    id: row.id,
    number: row.number,
    floor: row.floor,
    status: row.status,
    isOutOfOrder: row.isOutOfOrder,
    outOfOrderReason: row.outOfOrderReason,
    roomTypeId: row.roomTypeId,
    propertyId: row.propertyId,
  };
}

export interface AvailabilityCell {
  state: string;
  reservation: {
    id: string;
    code: string;
    status: string;
    arrivalDate: string;
    departureDate: string;
  } | null;
}

export interface AvailabilityMatrix {
  from: string;
  to: string;
  days: string[];
  rooms: RoomListItem[];
  cells: Record<string, Record<string, AvailabilityCell>>;
}

export interface RoomTypeAvailability {
  roomTypeId: string;
  code: string;
  name: string;
  description: string | null;
  baseOccupancy: number;
  maxOccupancy: number;
  totalRooms: number;
  availableRooms: number;
  pricePerNight: string;
  nights: number;
  totalForStay: string;
  currency: string;
}

// Resolver compartido: igual contrato que reservations.service +
// post-room-charges. Mover a packages/db en futuro refactor.
function resolveDailyRateAttrs(
  defaultRate: Prisma.Decimal,
  ratePlanAttrs: Prisma.JsonValue | null,
): Prisma.Decimal {
  if (
    ratePlanAttrs &&
    typeof ratePlanAttrs === 'object' &&
    !Array.isArray(ratePlanAttrs) &&
    'dailyRate' in ratePlanAttrs
  ) {
    const raw = (ratePlanAttrs as Record<string, unknown>).dailyRate;
    if (typeof raw === 'number' || typeof raw === 'string') {
      try {
        return new Prisma.Decimal(raw);
      } catch {
        // fall through
      }
    }
  }
  return new Prisma.Decimal(defaultRate);
}
