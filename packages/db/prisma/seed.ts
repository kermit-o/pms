/**
 * Seed de desarrollo. Crea un tenant demo + un usuario admin + una property.
 *
 * Usa UUIDs deterministas para que el bootstrap de Keycloak (que setea el
 * atributo tenant_id en el usuario admin@demo.local) coincida con la DB
 * sin tener que sincronizar dinamicamente.
 *
 * Uso:
 *   pnpm --filter @pms/db seed
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { PrismaClient, TenantStatus, UserStatus } from '@prisma/client';

const envCandidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
for (const path of envCandidates) {
  if (existsSync(path)) {
    loadDotenv({ path });
    break;
  }
}

const adminUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!adminUrl) {
  throw new Error('DIRECT_URL (or DATABASE_URL) must be set for seeding');
}

// UUIDs deterministas — sincronizados con scripts/keycloak-bootstrap.ts
export const DEMO_TENANT_ID = '11111111-1111-1111-1111-111111111111';
export const DEMO_PROPERTY_ID = '11111111-1111-1111-1111-111111111002';
export const DEMO_ADMIN_USER_ID = '11111111-1111-1111-1111-111111111003';
export const DEMO_ADMIN_EMAIL = 'admin@demo.local';

const prisma = new PrismaClient({
  datasources: { db: { url: adminUrl } },
});

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: DEMO_TENANT_ID },
    update: {},
    create: {
      id: DEMO_TENANT_ID,
      slug: 'demo',
      name: 'Hotel Demo',
      status: TenantStatus.TRIAL,
    },
  });

  const property = await prisma.property.upsert({
    where: { id: DEMO_PROPERTY_ID },
    update: {},
    create: {
      id: DEMO_PROPERTY_ID,
      tenantId: tenant.id,
      code: 'BCN01',
      name: 'Hotel Demo Barcelona',
      timezone: 'Europe/Madrid',
      currency: 'EUR',
      locale: 'es-ES',
    },
  });

  const adminUser = await prisma.user.upsert({
    where: { id: DEMO_ADMIN_USER_ID },
    update: {},
    create: {
      id: DEMO_ADMIN_USER_ID,
      tenantId: tenant.id,
      email: DEMO_ADMIN_EMAIL,
      fullName: 'Demo Admin',
      status: UserStatus.ACTIVE,
    },
  });

  // Output a stderr — la regla no-console permite warn/error pero no log.
  // Es un script CLI, no es un servicio.
  console.error('Seed completed:');
  console.error({ tenantId: tenant.id, propertyId: property.id, adminUserId: adminUser.id });
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
