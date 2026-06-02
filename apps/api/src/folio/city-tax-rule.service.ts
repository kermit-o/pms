import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CityTaxRegion, Prisma } from '@pms/db';
import type { AuthUser } from '../auth';
import { PrismaService } from '../db';

/**
 * RFC-001 §3.3 — gestiona la regla de city tax por property.
 *
 * Modelo: una fila por property (clave única). Updates son destructivos
 * sobre la fila; el histórico vive en el audit log.
 */
@Injectable()
export class CityTaxRuleService {
  private readonly log = new Logger(CityTaxRuleService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getRule(
    user: AuthUser,
    correlationId: string,
    propertyId: string,
  ): Promise<CityTaxRuleDto | null> {
    const ctx = tenantCtx(user, correlationId);
    return this.prisma.withTenant(ctx, async (tx) => {
      const row = await tx.cityTaxRule.findUnique({ where: { propertyId } });
      return row ? toDto(row) : null;
    });
  }

  /** Variante interna usada por PostCityTaxStep (ya dentro de una tx). */
  async getRuleTx(
    tx: Prisma.TransactionClient,
    propertyId: string,
  ): Promise<CityTaxRuleDto | null> {
    const row = await tx.cityTaxRule.findUnique({ where: { propertyId } });
    return row ? toDto(row) : null;
  }

  async upsertRule(
    user: AuthUser,
    correlationId: string,
    propertyId: string,
    input: UpsertCityTaxRuleInput,
  ): Promise<CityTaxRuleDto> {
    const ctx = tenantCtx(user, correlationId);
    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, deletedAt: null },
        select: { id: true },
      });
      if (!property) throw new NotFoundException(`Property ${propertyId} not found`);
      return tx.cityTaxRule.upsert({
        where: { propertyId },
        create: {
          tenantId: user.tenantId,
          propertyId,
          region: input.region,
          amountPerNight: new Prisma.Decimal(input.amountPerNight),
          appliesToAdults: input.appliesToAdults,
          appliesToChildren: input.appliesToChildren,
          childAgeThreshold: input.childAgeThreshold,
          maxNights: input.maxNights,
        },
        update: {
          region: input.region,
          amountPerNight: new Prisma.Decimal(input.amountPerNight),
          appliesToAdults: input.appliesToAdults,
          appliesToChildren: input.appliesToChildren,
          childAgeThreshold: input.childAgeThreshold,
          maxNights: input.maxNights,
        },
      });
    });
    this.log.log(
      `city-tax-rule updated tenant=${user.tenantId} property=${propertyId} ` +
        `region=${input.region} amount=${input.amountPerNight}`,
    );
    return toDto(result);
  }
}

export interface UpsertCityTaxRuleInput {
  region: CityTaxRegion;
  amountPerNight: number;
  appliesToAdults: boolean;
  appliesToChildren: boolean;
  childAgeThreshold: number;
  maxNights: number;
}

export interface CityTaxRuleDto {
  propertyId: string;
  region: CityTaxRegion;
  amountPerNight: string;
  appliesToAdults: boolean;
  appliesToChildren: boolean;
  childAgeThreshold: number;
  maxNights: number;
}

function toDto(row: {
  propertyId: string;
  region: CityTaxRegion;
  amountPerNight: Prisma.Decimal;
  appliesToAdults: boolean;
  appliesToChildren: boolean;
  childAgeThreshold: number;
  maxNights: number;
}): CityTaxRuleDto {
  return {
    propertyId: row.propertyId,
    region: row.region,
    amountPerNight: row.amountPerNight.toString(),
    appliesToAdults: row.appliesToAdults,
    appliesToChildren: row.appliesToChildren,
    childAgeThreshold: row.childAgeThreshold,
    maxNights: row.maxNights,
  };
}

function tenantCtx(user: AuthUser, correlationId: string) {
  return {
    tenantId: user.tenantId,
    actorId: user.sub,
    correlationId,
  };
}
