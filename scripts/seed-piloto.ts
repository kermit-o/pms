/**
 * Seed para el hotel piloto ficticio (Hotel Berenjena Boutique).
 *
 * Estructura realista para UAT >=14 dias:
 *  - 1 tenant + 1 property
 *  - 6 tipos de habitacion (IND, DBL, SUP, TWN, JSU, SUI)
 *  - 45 habitaciones distribuidas en 5 plantas
 *  - 1 rate plan BAR (Best Available Rate)
 *  - 6 users (3 FO + 1 NA + 1 HSK supervisor + 4 housekeepers)
 *
 * Idempotente: usa upsert con UUIDs deterministas.
 *
 * Uso (desde la raiz del monorepo, contra la DB de produccion en Fly):
 *   DIRECT_URL="postgres://...@pms-postgres.flycast:5432/pms_api" \
 *     pnpm tsx scripts/seed-piloto.ts
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

// ----- UUIDs deterministas del piloto -----
export const PILOTO_TENANT_ID = '22222222-2222-2222-2222-222222222222';
export const PILOTO_PROPERTY_ID = '22222222-2222-2222-2222-222222222002';

const ROOM_TYPE = {
  IND: '22222222-2222-2222-2222-2222222220a1',
  DBL: '22222222-2222-2222-2222-2222222220a2',
  SUP: '22222222-2222-2222-2222-2222222220a3',
  TWN: '22222222-2222-2222-2222-2222222220a4',
  JSU: '22222222-2222-2222-2222-2222222220a5',
  SUI: '22222222-2222-2222-2222-2222222220a6',
};

const RATE_PLAN_BAR_ID = '22222222-2222-2222-2222-2222222220b1';

const USER_IDS = {
  fo1: '22222222-2222-2222-2222-2222222220c1',
  fo2: '22222222-2222-2222-2222-2222222220c2',
  fo3: '22222222-2222-2222-2222-2222222220c3',
  na: '22222222-2222-2222-2222-2222222220c4',
  hskSup: '22222222-2222-2222-2222-2222222220c5',
  hsk1: '22222222-2222-2222-2222-2222222220c6',
  hsk2: '22222222-2222-2222-2222-2222222220c7',
  hsk3: '22222222-2222-2222-2222-2222222220c8',
  hsk4: '22222222-2222-2222-2222-2222222220c9',
};

const prisma = new PrismaClient({
  datasources: { db: { url: adminUrl } },
});

interface RoomTypeDef {
  key: keyof typeof ROOM_TYPE;
  code: string;
  name: string;
  description: string;
  baseOccupancy: number;
  maxOccupancy: number;
  defaultRate: number;
}

const ROOM_TYPES: RoomTypeDef[] = [
  {
    key: 'IND',
    code: 'IND',
    name: 'Individual',
    description: 'Habitacion individual con cama de 90cm.',
    baseOccupancy: 1,
    maxOccupancy: 1,
    defaultRate: 75.0,
  },
  {
    key: 'DBL',
    code: 'DBL',
    name: 'Doble Estandar',
    description: 'Habitacion doble con cama de matrimonio.',
    baseOccupancy: 2,
    maxOccupancy: 2,
    defaultRate: 95.0,
  },
  {
    key: 'SUP',
    code: 'SUP',
    name: 'Doble Superior',
    description: 'Doble superior con vistas y zona de trabajo.',
    baseOccupancy: 2,
    maxOccupancy: 3,
    defaultRate: 130.0,
  },
  {
    key: 'TWN',
    code: 'TWN',
    name: 'Twin',
    description: 'Habitacion con dos camas individuales.',
    baseOccupancy: 2,
    maxOccupancy: 2,
    defaultRate: 95.0,
  },
  {
    key: 'JSU',
    code: 'JSU',
    name: 'Junior Suite',
    description: 'Junior suite con salon separado.',
    baseOccupancy: 2,
    maxOccupancy: 4,
    defaultRate: 180.0,
  },
  {
    key: 'SUI',
    code: 'SUI',
    name: 'Suite',
    description: 'Suite con dormitorio, salon y banera.',
    baseOccupancy: 2,
    maxOccupancy: 4,
    defaultRate: 280.0,
  },
];

interface RoomDef {
  number: string;
  floor: string;
  type: keyof typeof ROOM_TYPE;
}

// 45 habitaciones distribuidas:
// Planta 1: 8 IND (101-108)
// Planta 2: 18 DBL (201-218)
// Planta 3: 10 SUP (301-310)
// Planta 4: 5 TWN (401-405)
// Planta 5: 3 JSU (501-503) + 1 SUI (504)
const ROOMS: RoomDef[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    number: String(101 + i),
    floor: '1',
    type: 'IND' as const,
  })),
  ...Array.from({ length: 18 }, (_, i) => ({
    number: String(201 + i),
    floor: '2',
    type: 'DBL' as const,
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    number: String(301 + i),
    floor: '3',
    type: 'SUP' as const,
  })),
  ...Array.from({ length: 5 }, (_, i) => ({
    number: String(401 + i),
    floor: '4',
    type: 'TWN' as const,
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    number: String(501 + i),
    floor: '5',
    type: 'JSU' as const,
  })),
  { number: '504', floor: '5', type: 'SUI' as const },
];

interface UserDef {
  id: string;
  email: string;
  fullName: string;
}

const USERS: UserDef[] = [
  { id: USER_IDS.fo1, email: 'recepcion1@berenjena-demo.local', fullName: 'Maria Recepcion' },
  { id: USER_IDS.fo2, email: 'recepcion2@berenjena-demo.local', fullName: 'Carlos Recepcion' },
  { id: USER_IDS.fo3, email: 'recepcion3@berenjena-demo.local', fullName: 'Ana Recepcion' },
  { id: USER_IDS.na, email: 'nightaudit@berenjena-demo.local', fullName: 'Luis Night Auditor' },
  { id: USER_IDS.hskSup, email: 'hsk-supervisor@berenjena-demo.local', fullName: 'Pilar Supervisor HSK' },
  { id: USER_IDS.hsk1, email: 'hsk1@berenjena-demo.local', fullName: 'Rosa Housekeeper' },
  { id: USER_IDS.hsk2, email: 'hsk2@berenjena-demo.local', fullName: 'Ines Housekeeper' },
  { id: USER_IDS.hsk3, email: 'hsk3@berenjena-demo.local', fullName: 'Miguel Housekeeper' },
  { id: USER_IDS.hsk4, email: 'hsk4@berenjena-demo.local', fullName: 'Andrea Housekeeper' },
];

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: PILOTO_TENANT_ID },
    update: { name: 'Hotel Berenjena Boutique' },
    create: {
      id: PILOTO_TENANT_ID,
      slug: 'berenjena',
      name: 'Hotel Berenjena Boutique',
      status: TenantStatus.TRIAL,
    },
  });

  const property = await prisma.property.upsert({
    where: { id: PILOTO_PROPERTY_ID },
    update: {},
    create: {
      id: PILOTO_PROPERTY_ID,
      tenantId: tenant.id,
      code: 'BBM01',
      name: 'Berenjena Boutique Madrid',
      timezone: 'Europe/Madrid',
      currency: 'EUR',
      locale: 'es-ES',
    },
  });

  const roomTypeIds: Record<string, string> = {};
  for (const rt of ROOM_TYPES) {
    const created = await prisma.roomType.upsert({
      where: { id: ROOM_TYPE[rt.key] },
      update: { defaultRate: rt.defaultRate },
      create: {
        id: ROOM_TYPE[rt.key],
        tenantId: tenant.id,
        propertyId: property.id,
        code: rt.code,
        name: rt.name,
        description: rt.description,
        baseOccupancy: rt.baseOccupancy,
        maxOccupancy: rt.maxOccupancy,
        defaultRate: rt.defaultRate,
      },
    });
    roomTypeIds[rt.key] = created.id;
  }

  for (const r of ROOMS) {
    await prisma.room.upsert({
      where: {
        tenantId_propertyId_number: {
          tenantId: tenant.id,
          propertyId: property.id,
          number: r.number,
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        propertyId: property.id,
        roomTypeId: roomTypeIds[r.type],
        number: r.number,
        floor: r.floor,
        status: RoomStatus.CLEAN,
      },
    });
  }

  const ratePlan = await prisma.ratePlan.upsert({
    where: { id: RATE_PLAN_BAR_ID },
    update: {},
    create: {
      id: RATE_PLAN_BAR_ID,
      tenantId: tenant.id,
      propertyId: property.id,
      code: 'BAR',
      name: 'Best Available Rate',
      description: 'Tarifa flexible. Cancelacion gratuita hasta 24h antes.',
      isPublic: true,
    },
  });

  for (const u of USERS) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: { fullName: u.fullName, status: UserStatus.INVITED },
      create: {
        id: u.id,
        tenantId: tenant.id,
        email: u.email,
        fullName: u.fullName,
        status: UserStatus.INVITED,
      },
    });
  }

  console.error('Piloto seed completed:');
  console.error({
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    propertyId: property.id,
    propertyCode: property.code,
    roomTypes: Object.fromEntries(ROOM_TYPES.map((rt) => [rt.key, roomTypeIds[rt.key]])),
    rooms: ROOMS.length,
    ratePlanId: ratePlan.id,
    users: USERS.length,
  });
}

main()
  .catch((err) => {
    console.error('Piloto seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
