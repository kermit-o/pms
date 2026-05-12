import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BusinessDayStatus, Prisma } from '@pms/db';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';
import type { AuthUser } from '../auth';
import { CloseDayDto, ListDaysQuery, ReopenDayDto } from './dto';

/**
 * Business-day locking. Sprint 2 W5.
 *
 * `business_day_states (propertyId, businessDate)` is the source of truth
 * for whether mutations on a given operating day are allowed. Reservation
 * and folio services consult this table via `assertDayOpen` before applying
 * writes that touch a day in the past or the current day after close.
 *
 * close: front_desk + night_auditor
 * reopen: tenant_admin only (audit + reason recorded)
 */
@Injectable()
export class BusinessDayService {
  private readonly log = new Logger(BusinessDayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventbusService,
  ) {}

  async list(
    user: AuthUser,
    correlationId: string,
    query: ListDaysQuery,
  ): Promise<BusinessDayDto[]> {
    const ctx = tenantCtx(user, correlationId);
    const where: Prisma.BusinessDayStateWhereInput = {
      propertyId: query.propertyId,
    };
    if (query.from || query.to) {
      where.businessDate = {};
      if (query.from) (where.businessDate as Prisma.DateTimeFilter).gte = new Date(query.from);
      if (query.to) (where.businessDate as Prisma.DateTimeFilter).lte = new Date(query.to);
    }
    const rows = await this.prisma.withTenant(ctx, (tx) =>
      tx.businessDayState.findMany({
        where,
        orderBy: { businessDate: 'desc' },
        take: 90,
      }),
    );
    return rows.map(toDto);
  }

  async getState(
    user: AuthUser,
    correlationId: string,
    propertyId: string,
    businessDate: string,
  ): Promise<BusinessDayDto> {
    const ctx = tenantCtx(user, correlationId);
    const row = await this.prisma.withTenant(ctx, (tx) =>
      tx.businessDayState.findFirst({
        where: { propertyId, businessDate: new Date(businessDate) },
      }),
    );
    if (!row) {
      return {
        propertyId,
        businessDate,
        status: BusinessDayStatus.OPEN,
        closedAt: null,
        closedByUserId: null,
        reopenedAt: null,
        reopenedReason: null,
      };
    }
    return toDto(row);
  }

  async close(
    user: AuthUser,
    correlationId: string,
    input: CloseDayDto,
  ): Promise<{ propertyId: string; businessDate: string }> {
    const ctx = tenantCtx(user, correlationId);
    const businessDate = new Date(input.businessDate);
    const closedAt = new Date();

    await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.businessDayState.findFirst({
        where: { propertyId: input.propertyId, businessDate },
      });
      if (existing && existing.status === BusinessDayStatus.CLOSED) {
        throw new ConflictException(`Business day ${input.businessDate} is already closed`);
      }

      // No permitir cerrar dias futuros: la operativa hotelera cierra el dia
      // activo cuando termina el turno de noche, nunca un dia que aun no ha
      // pasado. Permitimos hoy mismo (UTC) por simplicidad — la hora de cierre
      // efectiva la marca closedAt.
      const today = new Date(new Date().toISOString().slice(0, 10));
      if (businessDate.getTime() > today.getTime()) {
        throw new ConflictException(
          `Cannot close future business day ${input.businessDate}`,
        );
      }

      // No permitir cerrar dia N si hay algun N-X aun OPEN. Esto preserva
      // integridad contable y de audit log: la secuencia de cierres debe ser
      // cronologica. Solo bloqueamos si existe el registro OPEN — dias sin
      // registro (no hubo actividad) no necesitan cierre explicito.
      const earlierOpen = await tx.businessDayState.findFirst({
        where: {
          propertyId: input.propertyId,
          businessDate: { lt: businessDate },
          status: BusinessDayStatus.OPEN,
        },
        orderBy: { businessDate: 'asc' },
        select: { businessDate: true },
      });
      if (earlierOpen) {
        const earlier = earlierOpen.businessDate.toISOString().slice(0, 10);
        throw new ConflictException(
          `Cannot close ${input.businessDate}: earlier business day ${earlier} is still OPEN`,
        );
      }

      if (existing) {
        await tx.businessDayState.update({
          where: {
            propertyId_businessDate: {
              propertyId: input.propertyId,
              businessDate,
            },
          },
          data: {
            status: BusinessDayStatus.CLOSED,
            closedAt,
            closedByUserId: user.sub,
            reopenedAt: null,
            reopenedReason: null,
          },
        });
      } else {
        await tx.businessDayState.create({
          data: {
            tenantId: user.tenantId,
            propertyId: input.propertyId,
            businessDate,
            status: BusinessDayStatus.CLOSED,
            closedAt,
            closedByUserId: user.sub,
          },
        });
      }
    });

    await this.events.publish('business_day.closed', ctx, {
      propertyId: input.propertyId,
      businessDate: input.businessDate,
      closedAt: closedAt.toISOString(),
      closedByUserId: user.sub,
    });

    return {
      propertyId: input.propertyId,
      businessDate: input.businessDate,
    };
  }

  async reopen(
    user: AuthUser,
    correlationId: string,
    input: ReopenDayDto,
  ): Promise<{ propertyId: string; businessDate: string }> {
    const ctx = tenantCtx(user, correlationId);
    const businessDate = new Date(input.businessDate);
    const reopenedAt = new Date();

    await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.businessDayState.findFirst({
        where: { propertyId: input.propertyId, businessDate },
      });
      if (!existing) {
        throw new NotFoundException(`No business-day record for ${input.businessDate}`);
      }
      if (existing.status !== BusinessDayStatus.CLOSED) {
        throw new ConflictException(`Business day ${input.businessDate} is not closed`);
      }
      await tx.businessDayState.update({
        where: {
          propertyId_businessDate: {
            propertyId: input.propertyId,
            businessDate,
          },
        },
        data: {
          status: BusinessDayStatus.OPEN,
          reopenedAt,
          reopenedReason: input.reason,
        },
      });
    });

    await this.events.publish('business_day.reopened', ctx, {
      propertyId: input.propertyId,
      businessDate: input.businessDate,
      reopenedAt: reopenedAt.toISOString(),
      reason: input.reason,
    });

    return {
      propertyId: input.propertyId,
      businessDate: input.businessDate,
    };
  }
}

// ---------------------------------------------------------------------------

function tenantCtx(user: AuthUser, correlationId: string) {
  return {
    tenantId: user.tenantId,
    actorId: user.sub,
    correlationId,
  };
}

export interface BusinessDayDto {
  propertyId: string;
  businessDate: string;
  status: BusinessDayStatus;
  closedAt: string | null;
  closedByUserId: string | null;
  reopenedAt: string | null;
  reopenedReason: string | null;
}

function toDto(row: {
  propertyId: string;
  businessDate: Date;
  status: BusinessDayStatus;
  closedAt: Date | null;
  closedByUserId: string | null;
  reopenedAt: Date | null;
  reopenedReason: string | null;
}): BusinessDayDto {
  return {
    propertyId: row.propertyId,
    businessDate: row.businessDate.toISOString().slice(0, 10),
    status: row.status,
    closedAt: row.closedAt?.toISOString() ?? null,
    closedByUserId: row.closedByUserId,
    reopenedAt: row.reopenedAt?.toISOString() ?? null,
    reopenedReason: row.reopenedReason,
  };
}
