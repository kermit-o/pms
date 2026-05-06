import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LostFoundStatus, type Prisma } from '@pms/db';
import type { AuthUser } from '../auth';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';
import {
  ClaimLostFoundDto,
  DisposeLostFoundDto,
  ListLostFoundQuery,
  RegisterLostFoundDto,
} from './lost-found.dto';

/**
 * Lost & Found service. Sprint 4 W3.
 *
 * State machine:
 *   FOUND -> CLAIMED   (entregado a un huesped)
 *   FOUND -> DISPOSED  (descarte tras ventana legal)
 * CLAIMED y DISPOSED son terminales.
 *
 * El campo photoBase64 se almacena inline (data URL). En V2 migrara a S3 con
 * URLs firmadas; el resto del contrato no cambia.
 */
@Injectable()
export class LostFoundService {
  private readonly log = new Logger(LostFoundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventbusService,
  ) {}

  async register(
    user: AuthUser,
    correlationId: string,
    input: RegisterLostFoundDto,
  ): Promise<LostFoundView> {
    const ctx = tenantCtx(user, correlationId);

    const row = await this.prisma.withTenant(ctx, async (tx) => {
      if (input.roomId) {
        const room = await tx.room.findFirst({
          where: { id: input.roomId, propertyId: input.propertyId, deletedAt: null },
          select: { id: true },
        });
        if (!room) {
          throw new NotFoundException(
            `Room ${input.roomId} not found in property ${input.propertyId}`,
          );
        }
      }

      return tx.lostFoundItem.create({
        data: {
          tenantId: user.tenantId,
          propertyId: input.propertyId,
          roomId: input.roomId ?? null,
          foundByUserId: user.sub,
          description: input.description,
          photoBase64: input.photoBase64 ?? null,
          notes: input.notes ?? null,
        },
      });
    });

    await this.events.publish('lost_found.item_registered', ctx, {
      itemId: row.id,
      propertyId: row.propertyId,
      roomId: row.roomId,
      foundByUserId: row.foundByUserId,
      foundAt: row.foundAt.toISOString(),
      hasPhoto: row.photoBase64 != null,
    });

    return toView(row);
  }

  async list(
    user: AuthUser,
    correlationId: string,
    query: ListLostFoundQuery,
  ): Promise<LostFoundView[]> {
    const ctx = tenantCtx(user, correlationId);
    const where: Prisma.LostFoundItemWhereInput = { deletedAt: null };
    if (query.propertyId) where.propertyId = query.propertyId;
    if (query.status) where.status = query.status;

    const rows = await this.prisma.withTenant(ctx, (tx) =>
      tx.lostFoundItem.findMany({
        where,
        orderBy: [{ foundAt: 'desc' }],
        take: query.limit,
      }),
    );
    return rows.map(toView);
  }

  async findOne(user: AuthUser, correlationId: string, id: string): Promise<LostFoundView> {
    const ctx = tenantCtx(user, correlationId);
    const row = await this.prisma.withTenant(ctx, (tx) =>
      tx.lostFoundItem.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!row) throw new NotFoundException(`LostFoundItem ${id} not found`);
    return toView(row);
  }

  async claim(
    user: AuthUser,
    correlationId: string,
    id: string,
    input: ClaimLostFoundDto,
  ): Promise<LostFoundView> {
    const ctx = tenantCtx(user, correlationId);

    const row = await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.lostFoundItem.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException(`LostFoundItem ${id} not found`);
      if (existing.status !== LostFoundStatus.FOUND) {
        throw new ConflictException(`Item in status ${existing.status} cannot be claimed`);
      }
      if (input.guestId) {
        const guest = await tx.guest.findFirst({
          where: { id: input.guestId, deletedAt: null },
          select: { id: true },
        });
        if (!guest) throw new NotFoundException(`Guest ${input.guestId} not found`);
      }
      return tx.lostFoundItem.update({
        where: { id: existing.id },
        data: {
          status: LostFoundStatus.CLAIMED,
          claimedAt: new Date(),
          claimedByGuestId: input.guestId ?? null,
          claimedNotes: input.notes ?? null,
        },
      });
    });

    await this.events.publish('lost_found.item_claimed', ctx, {
      itemId: row.id,
      propertyId: row.propertyId,
      roomId: row.roomId,
      claimedByGuestId: row.claimedByGuestId,
      claimedByUserId: user.sub,
      claimedAt: row.claimedAt!.toISOString(),
    });

    return toView(row);
  }

  async dispose(
    user: AuthUser,
    correlationId: string,
    id: string,
    input: DisposeLostFoundDto,
  ): Promise<LostFoundView> {
    const ctx = tenantCtx(user, correlationId);

    const row = await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.lostFoundItem.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException(`LostFoundItem ${id} not found`);
      if (existing.status !== LostFoundStatus.FOUND) {
        throw new ConflictException(`Item in status ${existing.status} cannot be disposed`);
      }
      return tx.lostFoundItem.update({
        where: { id: existing.id },
        data: {
          status: LostFoundStatus.DISPOSED,
          disposedAt: new Date(),
          disposedNotes: input.reason,
        },
      });
    });

    await this.events.publish('lost_found.item_disposed', ctx, {
      itemId: row.id,
      propertyId: row.propertyId,
      roomId: row.roomId,
      disposedByUserId: user.sub,
      disposedAt: row.disposedAt!.toISOString(),
      reason: input.reason,
    });

    return toView(row);
  }
}

// ---------------------------------------------------------------------------

function tenantCtx(user: AuthUser, correlationId: string) {
  return { tenantId: user.tenantId, actorId: user.sub, correlationId };
}

export interface LostFoundView {
  id: string;
  propertyId: string;
  roomId: string | null;
  foundByUserId: string;
  foundAt: string;
  description: string;
  hasPhoto: boolean;
  status: LostFoundStatus;
  claimedByGuestId: string | null;
  claimedAt: string | null;
  disposedAt: string | null;
  notes: string | null;
}

function toView(row: {
  id: string;
  propertyId: string;
  roomId: string | null;
  foundByUserId: string;
  foundAt: Date;
  description: string;
  photoBase64: string | null;
  status: LostFoundStatus;
  claimedByGuestId: string | null;
  claimedAt: Date | null;
  disposedAt: Date | null;
  notes: string | null;
}): LostFoundView {
  return {
    id: row.id,
    propertyId: row.propertyId,
    roomId: row.roomId,
    foundByUserId: row.foundByUserId,
    foundAt: row.foundAt.toISOString(),
    description: row.description,
    hasPhoto: row.photoBase64 != null,
    status: row.status,
    claimedByGuestId: row.claimedByGuestId,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    disposedAt: row.disposedAt?.toISOString() ?? null,
    notes: row.notes,
  };
}
