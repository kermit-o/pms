/**
 * Backfill de PropertyTaxConfig + CityTaxRule (RFC-001 §3.1, §6 rollout).
 *
 * Para cada property existente que NO tenga aún una matriz tax config,
 * crea las 6 filas default (ROOM/BREAKFAST/EXTRA_FOOD 10%, EXTRA_OTHER
 * 21%, CITY_TAX/EXEMPT 0%). Para cada property sin CityTaxRule, crea
 * una con region=NONE y amount=0 (el admin del tenant la edita después
 * si su autonomía tiene city tax activa).
 *
 * Idempotente: si la config ya existe (clave única
 * property_id+category+effective_from), no la duplica.
 *
 * Uso (desde la raíz del monorepo):
 *
 *   DIRECT_URL="postgres://..." pnpm tsx scripts/backfill-property-tax-config.ts [--dry-run]
 *
 * Se ejecuta una sola vez al desplegar la feature. Después, el seed y
 * el onboarding crean estas filas en el flujo normal.
 */

import { PrismaClient, TaxCategory, CityTaxRegion, Prisma } from '@pms/db';

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

  const properties = await prisma.property.findMany({
    where: { deletedAt: null },
    select: { id: true, tenantId: true, code: true, name: true },
  });

  let taxCreated = 0;
  let cityCreated = 0;
  let skipped = 0;

  for (const property of properties) {
    for (const def of DEFAULTS) {
      const exists = await prisma.propertyTaxConfig.findFirst({
        where: { propertyId: property.id, category: def.category },
      });
      if (exists) {
        skipped += 1;
        continue;
      }
      if (!dryRun) {
        await prisma.propertyTaxConfig.create({
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

    const cityExists = await prisma.cityTaxRule.findUnique({
      where: { propertyId: property.id },
    });
    if (!cityExists) {
      if (!dryRun) {
        await prisma.cityTaxRule.create({
          data: {
            tenantId: property.tenantId,
            propertyId: property.id,
            region: CityTaxRegion.NONE,
            amountPerNight: new Prisma.Decimal('0'),
          },
        });
      }
      cityCreated += 1;
    } else {
      skipped += 1;
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        dryRun,
        propertiesScanned: properties.length,
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
