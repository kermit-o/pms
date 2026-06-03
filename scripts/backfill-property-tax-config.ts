/**
 * Backfill de PropertyTaxConfig + CityTaxRule (RFC-001 §3.1, §6 rollout).
 *
 * Para cada property que no tenga ya su matriz tax-config, crea las 6
 * filas default (ROOM/BREAKFAST/EXTRA_FOOD 10%, EXTRA_OTHER 21%,
 * CITY_TAX/EXEMPT 0%). Para cada property sin CityTaxRule, crea una
 * con region=NONE y amount=0. El admin del tenant la edita después
 * desde la UI si su autonomía tiene city tax activa.
 *
 * Idempotente — si la config ya existe, no la duplica.
 *
 * RLS: las tablas `properties`, `property_tax_configs` y `city_tax_rules`
 * tienen FORCE ROW LEVEL SECURITY. Este script itera por tenant
 * llamando `withTenant`, que setea `app.tenant_id` por tx — el patrón
 * idéntico al que usa el API en runtime.
 *
 * Uso (desde la raíz del monorepo o desde /app dentro del container Fly):
 *
 *   DATABASE_URL="postgres://…" pnpm tsx scripts/backfill-property-tax-config.ts [--dry-run]
 */

import { PrismaClient, TaxCategory, CityTaxRegion, Prisma, withTenant } from '@pms/db';

const DEFAULTS: Array<{ category: TaxCategory; rate: string }> = [
  { category: TaxCategory.ROOM, rate: '10.00' },
  { category: TaxCategory.BREAKFAST, rate: '10.00' },
  { category: TaxCategory.EXTRA_FOOD, rate: '10.00' },
  { category: TaxCategory.EXTRA_OTHER, rate: '21.00' },
  { category: TaxCategory.CITY_TAX, rate: '0.00' },
  { category: TaxCategory.EXEMPT, rate: '0.00' },
];

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();

  // 1. Lista tenants. La tabla tenants no tiene RLS (es admin-level).
  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null },
    select: { id: true, slug: true },
  });

  let totalProperties = 0;
  let taxCreated = 0;
  let cityCreated = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    await withTenant(prisma, { tenantId: tenant.id }, async (tx) => {
      const properties = await tx.property.findMany({
        where: { deletedAt: null },
        select: { id: true, tenantId: true },
      });
      totalProperties += properties.length;

      for (const property of properties) {
        for (const def of DEFAULTS) {
          const exists = await tx.propertyTaxConfig.findFirst({
            where: { propertyId: property.id, category: def.category },
            select: { id: true },
          });
          if (exists) {
            skipped += 1;
            continue;
          }
          if (!dryRun) {
            await tx.propertyTaxConfig.create({
              data: {
                tenantId: property.tenantId,
                propertyId: property.id,
                category: def.category,
                taxRate: new Prisma.Decimal(def.rate),
              },
            });
          }
          taxCreated += 1;
        }

        const cityExists = await tx.cityTaxRule.findUnique({
          where: { propertyId: property.id },
          select: { id: true },
        });
        if (cityExists) {
          skipped += 1;
        } else {
          if (!dryRun) {
            await tx.cityTaxRule.create({
              data: {
                tenantId: property.tenantId,
                propertyId: property.id,
                region: CityTaxRegion.NONE,
                amountPerNight: new Prisma.Decimal('0'),
              },
            });
          }
          cityCreated += 1;
        }
      }
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        dryRun,
        tenantsScanned: tenants.length,
        propertiesScanned: totalProperties,
        taxConfigsCreated: taxCreated,
        cityTaxRulesCreated: cityCreated,
        skippedExisting: skipped,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('backfill failed:', err);
  process.exit(1);
});
