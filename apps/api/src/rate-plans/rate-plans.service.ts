import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pms/db';
import { PrismaService } from '../db';
import type { AuthUser } from '../auth';
import type { CreateRatePlanDto, UpdateRatePlanDto } from './dto';

/**
 * Sprint 13 W1 — CRUD admin de rate plans por propiedad. Roles:
 * `tenant_admin` para escribir; cualquiera con acceso a la propiedad
 * lee. El IBE público lee directamente desde `PublicIbeService` sin
 * pasar por aquí (RLS por publicSlug).
 */
@Injectable()
export class RatePlansService {
  private readonly log = new Logger(RatePlansService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, correlationId: string, propertyId: string) {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    return this.prisma.withTenant(ctx, (tx) =>
      tx.ratePlan.findMany({
        where: { propertyId, deletedAt: null },
        orderBy: [{ nonRefundable: 'asc' }, { code: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          isPublic: true,
          currency: true,
          nonRefundable: true,
          discountPct: true,
          attributes: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    );
  }

  async create(
    user: AuthUser,
    correlationId: string,
    propertyId: string,
    input: CreateRatePlanDto,
  ) {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    return this.prisma.withTenant(ctx, async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, deletedAt: null },
        select: { id: true, currency: true },
      });
      if (!property) throw new NotFoundException(`Property ${propertyId} not found`);

      const attributes: Prisma.InputJsonValue | undefined =
        input.dailyRate !== undefined ? { dailyRate: input.dailyRate } : undefined;

      try {
        return await tx.ratePlan.create({
          data: {
            tenantId: user.tenantId,
            propertyId: property.id,
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            isPublic: input.isPublic,
            currency: input.currency ?? property.currency,
            nonRefundable: input.nonRefundable,
            discountPct:
              input.discountPct !== undefined ? new Prisma.Decimal(input.discountPct) : null,
            attributes,
          },
          select: { id: true, code: true, name: true },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException(`Rate plan ${input.code} ya existe en esta propiedad`);
        }
        throw err;
      }
    });
  }

  async update(
    user: AuthUser,
    correlationId: string,
    ratePlanId: string,
    input: UpdateRatePlanDto,
  ) {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    return this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.ratePlan.findFirst({
        where: { id: ratePlanId, deletedAt: null },
        select: { id: true, attributes: true },
      });
      if (!existing) throw new NotFoundException(`RatePlan ${ratePlanId} not found`);

      const nextAttributes =
        input.dailyRate === undefined
          ? undefined
          : input.dailyRate === null
            ? Prisma.JsonNull
            : ({
                ...((existing.attributes as object | null) ?? {}),
                dailyRate: input.dailyRate,
              } as Prisma.InputJsonValue);

      return tx.ratePlan.update({
        where: { id: ratePlanId },
        data: {
          name: input.name ?? undefined,
          description: input.description ?? undefined,
          isPublic: input.isPublic ?? undefined,
          nonRefundable: input.nonRefundable ?? undefined,
          discountPct:
            input.discountPct === undefined
              ? undefined
              : input.discountPct === null
                ? null
                : new Prisma.Decimal(input.discountPct),
          ...(nextAttributes !== undefined ? { attributes: nextAttributes } : {}),
        },
        select: { id: true, code: true, name: true },
      });
    });
  }
}
