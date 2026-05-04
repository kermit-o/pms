/**
 * Seed de desarrollo. Crea un tenant demo + un usuario admin + una property.
 *
 * Se conecta via DIRECT_URL (rol owner pms) para no chocar con RLS y para que
 * los inserts en seed sean directos sin tener que setear app.tenant_id.
 *
 * Uso:
 *   pnpm --filter @pms/db seed
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { PrismaClient, TenantStatus, UserStatus } from '@prisma/client';

// Carga .env de la raiz del monorepo cuando se ejecuta desde packages/db.
const envCandidates = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
];
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

const prisma = new PrismaClient({
  datasources: { db: { url: adminUrl } },
});

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      slug: 'demo',
      name: 'Hotel Demo',
      status: TenantStatus.TRIAL,
    },
  });

  const property = await prisma.property.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'BCN01' } },
    update: {},
    create: {
      tenantId: tenant.id,
      code: 'BCN01',
      name: 'Hotel Demo Barcelona',
      timezone: 'Europe/Madrid',
      currency: 'EUR',
      locale: 'es-ES',
    },
  });

  const adminUser = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@demo.local' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@demo.local',
      fullName: 'Demo Admin',
      status: UserStatus.ACTIVE,
    },
  });

  console.log('Seed completed:');
  console.log({ tenantId: tenant.id, propertyId: property.id, adminUserId: adminUser.id });
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
