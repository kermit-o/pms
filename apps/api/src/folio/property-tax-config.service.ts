import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, TaxCategory } from '@pms/db';
import type { AuthUser } from '../auth';
import { PrismaService } from '../db';

/**
 * RFC-001 §3.2 — gestiona la matriz IVA por property+categoría.
 *
 * Modelo histórico: cada PUT crea una fila nueva con effectiveFrom=hoy.
 * `resolveRate()` busca la más reciente con effectiveFrom <= today.
 *
 * Uso interno desde FolioService (resolver el rate al crear cargo) y
 * vía controller para que el admin del tenant edite la matriz.
 */
@Injectable()
export class PropertyTaxConfigService {
  private readonly log = new Logger(PropertyTaxConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Devuelve la matriz completa (un rate por categoría) ya resuelta al
   * día de hoy. Si una categoría no tiene config, no aparece — el
   * caller decide qué hacer (FolioService rechaza el cargo).
   */
  async getMatrix(
    user: AuthUser,
    correlationId: string,
    propertyId: string,
  ): Promise<Array<{ category: TaxCategory; taxRate: string; effectiveFrom: string }>> {
    const ctx = tenantCtx(user, correlationId);
    return this.prisma.withTenant(ctx, async (tx) => {
      const rows = await tx.propertyTaxConfig.findMany({
        where: { propertyId, effectiveFrom: { lte: new Date() } },
        orderBy: [{ category: 'asc' }, { effectiveFrom: 'desc' }],
      });
      // Coger sólo la última por categoría.
      const byCategory = new Map<TaxCategory, (typeof rows)[number]>();
      for (const row of rows) {
        if (!byCategory.has(row.category)) byCategory.set(row.category, row);
      }
      return Array.from(byCategory.values()).map((r) => ({
        category: r.category,
        taxRate: r.taxRate.toString(),
        effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
      }));
    });
  }

  /**
   * Resuelve el rate vigente para (propertyId, category) hoy. Devuelve
   * null si la categoría no está configurada — el FolioService lo
   * traduce a 400.
   */
  async resolveRate(
    tx: Prisma.TransactionClient,
    propertyId: string,
    category: TaxCategory,
  ): Promise<Prisma.Decimal | null> {
    const row = await tx.propertyTaxConfig.findFirst({
      where: { propertyId, category, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: 'desc' },
      select: { taxRate: true },
    });
    return row ? row.taxRate : null;
  }

  /**
   * Crea una entrada nueva en el histórico con effectiveFrom=hoy. Si
   * ya existe una con esa misma fecha, la actualiza (UPSERT vía
   * unique propertyId+category+effectiveFrom).
   */
  async upsertRate(
    user: AuthUser,
    correlationId: string,
    propertyId: string,
    category: TaxCategory,
    taxRate: number,
  ): Promise<{ category: TaxCategory; taxRate: string; effectiveFrom: string }> {
    const ctx = tenantCtx(user, correlationId);
    const today = startOfDayUtc();
    const result = await this.prisma.withTenant(ctx, async (tx) => {
      // Verifica que la property existe y es del tenant (RLS ya filtra,
      // pero queremos un 404 limpio).
      const property = await tx.property.findFirst({
        where: { id: propertyId, deletedAt: null },
        select: { id: true },
      });
      if (!property) {
        throw new NotFoundException(`Property ${propertyId} not found`);
      }
      const row = await tx.propertyTaxConfig.upsert({
        where: {
          propertyId_category_effectiveFrom: {
            propertyId,
            category,
            effectiveFrom: today,
          },
        },
        update: { taxRate: new Prisma.Decimal(taxRate) },
        create: {
          tenantId: user.tenantId,
          propertyId,
          category,
          taxRate: new Prisma.Decimal(taxRate),
          effectiveFrom: today,
        },
      });
      return row;
    });
    this.log.log(
      `tax-config updated tenant=${user.tenantId} property=${propertyId} ` +
        `category=${category} rate=${taxRate}`,
    );
    return {
      category: result.category,
      taxRate: result.taxRate.toString(),
      effectiveFrom: result.effectiveFrom.toISOString().slice(0, 10),
    };
  }
}

function startOfDayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function tenantCtx(user: AuthUser, correlationId: string) {
  return {
    tenantId: user.tenantId,
    actorId: user.sub,
    correlationId,
  };
}
