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
import { PrismaClient, RoomStatus, TenantStatus, UserStatus } from '@prisma/client';

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

export const DEMO_ROOM_TYPE_STD_ID = '11111111-1111-1111-1111-1111111110a1';
export const DEMO_ROOM_TYPE_DLX_ID = '11111111-1111-1111-1111-1111111110a2';
export const DEMO_RATE_PLAN_BAR_ID = '11111111-1111-1111-1111-1111111110b1';

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

  // ----- Sprint 2 pre-work demo data -----

  const standardType = await prisma.roomType.upsert({
    where: { id: DEMO_ROOM_TYPE_STD_ID },
    update: {},
    create: {
      id: DEMO_ROOM_TYPE_STD_ID,
      tenantId: tenant.id,
      propertyId: property.id,
      code: 'STD',
      name: 'Standard Double',
      description: 'Habitacion estandar con cama de matrimonio.',
      baseOccupancy: 2,
      maxOccupancy: 2,
      defaultRate: 95.0,
    },
  });

  const deluxeType = await prisma.roomType.upsert({
    where: { id: DEMO_ROOM_TYPE_DLX_ID },
    update: {},
    create: {
      id: DEMO_ROOM_TYPE_DLX_ID,
      tenantId: tenant.id,
      propertyId: property.id,
      code: 'DLX',
      name: 'Deluxe',
      description: 'Habitacion deluxe con vistas y zona de estar.',
      baseOccupancy: 2,
      maxOccupancy: 3,
      defaultRate: 145.0,
    },
  });

  // 6 habitaciones — 4 STD (101-104) + 2 DLX (201-202)
  const roomDefs = [
    { number: '101', floor: '1', roomTypeId: standardType.id },
    { number: '102', floor: '1', roomTypeId: standardType.id },
    { number: '103', floor: '1', roomTypeId: standardType.id },
    { number: '104', floor: '1', roomTypeId: standardType.id },
    { number: '201', floor: '2', roomTypeId: deluxeType.id },
    { number: '202', floor: '2', roomTypeId: deluxeType.id },
  ];

  for (const def of roomDefs) {
    await prisma.room.upsert({
      where: {
        tenantId_propertyId_number: {
          tenantId: tenant.id,
          propertyId: property.id,
          number: def.number,
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        propertyId: property.id,
        roomTypeId: def.roomTypeId,
        number: def.number,
        floor: def.floor,
        status: RoomStatus.CLEAN,
      },
    });
  }

  const ratePlan = await prisma.ratePlan.upsert({
    where: { id: DEMO_RATE_PLAN_BAR_ID },
    update: {},
    create: {
      id: DEMO_RATE_PLAN_BAR_ID,
      tenantId: tenant.id,
      propertyId: property.id,
      code: 'BAR',
      name: 'Best Available Rate',
      description: 'Tarifa flexible. Cancelacion gratuita hasta 24h antes.',
      isPublic: true,
    },
  });

  console.error('Seed completed:');
  console.error({
    tenantId: tenant.id,
    propertyId: property.id,
    adminUserId: adminUser.id,
    roomTypes: { std: standardType.id, dlx: deluxeType.id },
    rooms: roomDefs.length,
    ratePlan: ratePlan.id,
  });
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
