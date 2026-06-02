/**
 * Seed para el hotel piloto ficticio (Hotel Berenjena Boutique).
 *
 * Estructura realista para UAT >=14 dias:
 *  - 1 tenant + 1 property (publicado en IBE como /h/berenjena)
 *  - 6 tipos de habitacion (IND, DBL, SUP, TWN, JSU, SUI)
 *  - 45 habitaciones distribuidas en 5 plantas
 *  - 1 rate plan BAR (Best Available Rate)
 *  - 9 users (3 FO + 1 NA + 1 HSK supervisor + 4 housekeepers)
 *  - 5 huéspedes ficticios reutilizables
 *  - 8 reservas distribuidas en estados realistas (in-house, llegadas hoy,
 *    llegadas futuras, salida ayer, pendiente de garantía, cancelada)
 *  - Folios + cargos para las reservas in-house / checked-out
 *  - Tareas de housekeeping para hoy (CHECKOUT_CLEAN pendientes,
 *    STAYOVER_CLEAN completada de ayer, INSPECTION pendiente)
 *
 * Idempotente: usa upsert con UUIDs deterministas. Las fechas se recalculan
 * relativas a `new Date()` en cada ejecución — útil para revivir el dataset
 * tras semanas sin tocar.
 *
 * Uso (desde la raiz del monorepo, contra la DB de produccion en Fly):
 *   DIRECT_URL="postgres://...@pms-postgres.flycast:5432/pms_api" \
 *     pnpm tsx scripts/seed-piloto.ts
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import {
  FolioStatus,
  GuaranteeStatus,
  GuaranteeType,
  HousekeepingTaskStatus,
  HousekeepingTaskType,
  PrismaClient,
  ReservationSource,
  ReservationStatus,
  RoomStatus,
  TenantStatus,
  UserStatus,
} from '@prisma/client';

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
  {
    id: USER_IDS.hskSup,
    email: 'hsk-supervisor@berenjena-demo.local',
    fullName: 'Pilar Supervisor HSK',
  },
  { id: USER_IDS.hsk1, email: 'hsk1@berenjena-demo.local', fullName: 'Rosa Housekeeper' },
  { id: USER_IDS.hsk2, email: 'hsk2@berenjena-demo.local', fullName: 'Ines Housekeeper' },
  { id: USER_IDS.hsk3, email: 'hsk3@berenjena-demo.local', fullName: 'Miguel Housekeeper' },
  { id: USER_IDS.hsk4, email: 'hsk4@berenjena-demo.local', fullName: 'Andrea Housekeeper' },
];

// ----- Guests piloto: 5 personas ficticias reutilizables en reservas -----

const GUEST_IDS = {
  g1: '22222222-2222-2222-2222-2222222220d1',
  g2: '22222222-2222-2222-2222-2222222220d2',
  g3: '22222222-2222-2222-2222-2222222220d3',
  g4: '22222222-2222-2222-2222-2222222220d4',
  g5: '22222222-2222-2222-2222-2222222220d5',
};

interface GuestDef {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

const GUESTS: GuestDef[] = [
  {
    id: GUEST_IDS.g1,
    firstName: 'Sofía',
    lastName: 'García López',
    email: 'sofia.garcia@example.com',
    phone: '+34611111111',
  },
  {
    id: GUEST_IDS.g2,
    firstName: 'Marc',
    lastName: 'Fernández Vila',
    email: 'marc.fernandez@example.com',
    phone: '+34622222222',
  },
  {
    id: GUEST_IDS.g3,
    firstName: 'Liam',
    lastName: 'O’Brien',
    email: 'liam.obrien@example.com',
    phone: '+353851111111',
  },
  {
    id: GUEST_IDS.g4,
    firstName: 'Akiko',
    lastName: 'Tanaka',
    email: 'akiko.tanaka@example.com',
    phone: '+819011112222',
  },
  {
    id: GUEST_IDS.g5,
    firstName: 'Hugo',
    lastName: 'Martínez Ruiz',
    email: 'hugo.martinez@example.com',
    phone: '+34655555555',
  },
];

// ----- Reservas piloto: 8 reservas que cubren todos los estados clave -----

const RES_IDS = {
  inHouse1: '22222222-2222-2222-2222-2222222220e1', // CHECKED_IN, llegó hace 2 días, sale en 1
  inHouse2: '22222222-2222-2222-2222-2222222220e2', // CHECKED_IN, llegó ayer, sale hoy
  arrivalToday1: '22222222-2222-2222-2222-2222222220e3', // CONFIRMED, llegada HOY
  arrivalToday2: '22222222-2222-2222-2222-2222222220e4', // CONFIRMED, llegada HOY (walk-in friendly)
  arrivalFuture1: '22222222-2222-2222-2222-2222222220e5', // CONFIRMED, llegada mañana
  arrivalFuture2: '22222222-2222-2222-2222-2222222220e6', // CONFIRMED, llegada +7 días
  checkedOutYesterday: '22222222-2222-2222-2222-2222222220e7', // CHECKED_OUT, salió ayer
  pendingGuarantee: '22222222-2222-2222-2222-2222222220e8', // PENDING, deadline garantía en 2h
};

const RES_GUEST_LINK_IDS = {
  inHouse1: '22222222-2222-2222-2222-2222222220f1',
  inHouse2: '22222222-2222-2222-2222-2222222220f2',
  arrivalToday1: '22222222-2222-2222-2222-2222222220f3',
  arrivalToday2: '22222222-2222-2222-2222-2222222220f4',
  arrivalFuture1: '22222222-2222-2222-2222-2222222220f5',
  arrivalFuture2: '22222222-2222-2222-2222-2222222220f6',
  checkedOutYesterday: '22222222-2222-2222-2222-2222222220f7',
  pendingGuarantee: '22222222-2222-2222-2222-2222222220f8',
};

interface ResDef {
  id: string;
  reservationGuestId: string;
  guestId: string;
  code: string;
  status: ReservationStatus;
  /** Offset en días desde hoy para arrival (negativo = pasado). */
  arrivalOffset: number;
  /** Offset en días desde hoy para departure. */
  departureOffset: number;
  roomNumber: string;
  roomType: keyof typeof ROOM_TYPE;
  adults: number;
  children: number;
  totalAmount: number;
  guaranteeType: GuaranteeType;
  guaranteeStatus: GuaranteeStatus;
  /** Si está CHECKED_IN o CHECKED_OUT, se marca el timestamp. */
  checkedIn?: boolean;
  checkedOut?: boolean;
}

const RESERVATIONS: ResDef[] = [
  {
    id: RES_IDS.inHouse1,
    reservationGuestId: RES_GUEST_LINK_IDS.inHouse1,
    guestId: GUEST_IDS.g1,
    code: 'BBM-INH001',
    status: ReservationStatus.CHECKED_IN,
    arrivalOffset: -2,
    departureOffset: 1,
    roomNumber: '101',
    roomType: 'IND',
    adults: 1,
    children: 0,
    totalAmount: 225, // 3 noches × 75
    guaranteeType: GuaranteeType.CARD_ON_FILE,
    guaranteeStatus: GuaranteeStatus.SECURED,
    checkedIn: true,
  },
  {
    id: RES_IDS.inHouse2,
    reservationGuestId: RES_GUEST_LINK_IDS.inHouse2,
    guestId: GUEST_IDS.g2,
    code: 'BBM-INH002',
    status: ReservationStatus.CHECKED_IN,
    arrivalOffset: -1,
    departureOffset: 0,
    roomNumber: '201',
    roomType: 'DBL',
    adults: 2,
    children: 0,
    totalAmount: 95,
    guaranteeType: GuaranteeType.CARD_ON_FILE,
    guaranteeStatus: GuaranteeStatus.SECURED,
    checkedIn: true,
  },
  {
    id: RES_IDS.arrivalToday1,
    reservationGuestId: RES_GUEST_LINK_IDS.arrivalToday1,
    guestId: GUEST_IDS.g3,
    code: 'BBM-ARR001',
    status: ReservationStatus.CONFIRMED,
    arrivalOffset: 0,
    departureOffset: 2,
    roomNumber: '301',
    roomType: 'SUP',
    adults: 2,
    children: 0,
    totalAmount: 260, // 2 noches × 130
    guaranteeType: GuaranteeType.CARD_ON_FILE,
    guaranteeStatus: GuaranteeStatus.SECURED,
  },
  {
    id: RES_IDS.arrivalToday2,
    reservationGuestId: RES_GUEST_LINK_IDS.arrivalToday2,
    guestId: GUEST_IDS.g4,
    code: 'BBM-ARR002',
    status: ReservationStatus.CONFIRMED,
    arrivalOffset: 0,
    departureOffset: 3,
    roomNumber: '202',
    roomType: 'DBL',
    adults: 2,
    children: 0,
    totalAmount: 285, // 3 noches × 95
    guaranteeType: GuaranteeType.HOTEL_GUARANTEE,
    guaranteeStatus: GuaranteeStatus.SECURED,
  },
  {
    id: RES_IDS.arrivalFuture1,
    reservationGuestId: RES_GUEST_LINK_IDS.arrivalFuture1,
    guestId: GUEST_IDS.g5,
    code: 'BBM-FUT001',
    status: ReservationStatus.CONFIRMED,
    arrivalOffset: 1,
    departureOffset: 4,
    roomNumber: '401',
    roomType: 'TWN',
    adults: 2,
    children: 0,
    totalAmount: 285,
    guaranteeType: GuaranteeType.CARD_ON_FILE,
    guaranteeStatus: GuaranteeStatus.SECURED,
  },
  {
    id: RES_IDS.arrivalFuture2,
    reservationGuestId: RES_GUEST_LINK_IDS.arrivalFuture2,
    guestId: GUEST_IDS.g1,
    code: 'BBM-FUT002',
    status: ReservationStatus.CONFIRMED,
    arrivalOffset: 7,
    departureOffset: 10,
    roomNumber: '501',
    roomType: 'JSU',
    adults: 2,
    children: 2,
    totalAmount: 540, // 3 × 180
    guaranteeType: GuaranteeType.CARD_ON_FILE,
    guaranteeStatus: GuaranteeStatus.SECURED,
  },
  {
    id: RES_IDS.checkedOutYesterday,
    reservationGuestId: RES_GUEST_LINK_IDS.checkedOutYesterday,
    guestId: GUEST_IDS.g2,
    code: 'BBM-OUT001',
    status: ReservationStatus.CHECKED_OUT,
    arrivalOffset: -3,
    departureOffset: -1,
    roomNumber: '102',
    roomType: 'IND',
    adults: 1,
    children: 0,
    totalAmount: 150, // 2 noches × 75
    guaranteeType: GuaranteeType.CARD_ON_FILE,
    guaranteeStatus: GuaranteeStatus.RELEASED,
    checkedIn: true,
    checkedOut: true,
  },
  {
    id: RES_IDS.pendingGuarantee,
    reservationGuestId: RES_GUEST_LINK_IDS.pendingGuarantee,
    guestId: GUEST_IDS.g3,
    code: 'BBM-PND001',
    status: ReservationStatus.PENDING,
    arrivalOffset: 14,
    departureOffset: 16,
    roomNumber: '203',
    roomType: 'DBL',
    adults: 2,
    children: 0,
    totalAmount: 190,
    guaranteeType: GuaranteeType.CARD_ON_FILE,
    guaranteeStatus: GuaranteeStatus.PENDING,
  },
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

  // ------------------------------------------------------------------
  // Publicación en IBE — sin esto /h/berenjena devuelve 404
  // ------------------------------------------------------------------
  if (!property.publicSlug || !property.publishedAt) {
    await prisma.property.update({
      where: { id: property.id },
      data: { publicSlug: 'berenjena', publishedAt: new Date() },
    });
  }

  // ------------------------------------------------------------------
  // Guests
  // ------------------------------------------------------------------
  for (const g of GUESTS) {
    await prisma.guest.upsert({
      where: { id: g.id },
      update: { firstName: g.firstName, lastName: g.lastName, email: g.email, phone: g.phone },
      create: {
        id: g.id,
        tenantId: tenant.id,
        firstName: g.firstName,
        lastName: g.lastName,
        email: g.email,
        phone: g.phone,
      },
    });
  }

  // ------------------------------------------------------------------
  // Tax config (RFC-001 §3.1) — matriz IVA España 2026 + city tax NONE.
  // El piloto Berenjena Madrid no aplica city tax (Madrid no lo tiene
  // activado). Cataluña/Baleares/Valencia se configuran en su tenant.
  // ------------------------------------------------------------------
  const TAX_DEFAULTS: Array<{ category: 'ROOM' | 'BREAKFAST' | 'EXTRA_FOOD' | 'EXTRA_OTHER' | 'CITY_TAX' | 'EXEMPT'; rate: string }> = [
    { category: 'ROOM', rate: '10.00' },
    { category: 'BREAKFAST', rate: '10.00' },
    { category: 'EXTRA_FOOD', rate: '10.00' },
    { category: 'EXTRA_OTHER', rate: '21.00' },
    { category: 'CITY_TAX', rate: '0.00' },
    { category: 'EXEMPT', rate: '0.00' },
  ];
  for (const t of TAX_DEFAULTS) {
    const exists = await prisma.propertyTaxConfig.findFirst({
      where: { propertyId: property.id, category: t.category as never },
    });
    if (!exists) {
      await prisma.propertyTaxConfig.create({
        data: {
          tenantId: tenant.id,
          propertyId: property.id,
          category: t.category as never,
          taxRate: t.rate,
        },
      });
    }
  }
  const cityTaxExists = await prisma.cityTaxRule.findUnique({
    where: { propertyId: property.id },
  });
  if (!cityTaxExists) {
    await prisma.cityTaxRule.create({
      data: {
        tenantId: tenant.id,
        propertyId: property.id,
        region: 'NONE',
        amountPerNight: '0',
      },
    });
  }

  // Mapa room.number → room.id (lo necesitamos para reservations + HSK tasks).
  const roomsByNumber = new Map<string, string>();
  for (const r of await prisma.room.findMany({
    where: { propertyId: property.id },
    select: { id: true, number: true },
  })) {
    roomsByNumber.set(r.number, r.id);
  }

  // ------------------------------------------------------------------
  // Reservations + ReservationGuest + Folio (+entries)
  // ------------------------------------------------------------------
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const addDays = (d: Date, n: number): Date => {
    const out = new Date(d);
    out.setUTCDate(out.getUTCDate() + n);
    return out;
  };

  for (const r of RESERVATIONS) {
    const arrival = addDays(today, r.arrivalOffset);
    const departure = addDays(today, r.departureOffset);
    const roomId = r.roomType ? roomsByNumber.get(r.roomNumber) : undefined;
    if (!roomId) {
      console.warn(`seed-piloto: room ${r.roomNumber} not found, skipping reservation ${r.code}`);
      continue;
    }
    const checkedInAt = r.checkedIn ? addDays(arrival, 0) : null;
    const checkedOutAt = r.checkedOut ? departure : null;
    const guaranteeDeadline =
      r.status === ReservationStatus.PENDING ? new Date(Date.now() + 2 * 3600 * 1000) : null;

    const baseData = {
      tenantId: tenant.id,
      propertyId: property.id,
      roomTypeId: roomTypeIds[r.roomType],
      roomId,
      ratePlanId: ratePlan.id,
      code: r.code,
      status: r.status,
      arrivalDate: arrival,
      departureDate: departure,
      adults: r.adults,
      children: r.children,
      totalAmount: r.totalAmount,
      currency: 'EUR',
      source: ReservationSource.DIRECT,
      guaranteeType: r.guaranteeType,
      guaranteeStatus: r.guaranteeStatus,
      guaranteeDeadline,
      checkedInAt,
      checkedOutAt,
    };

    await prisma.reservation.upsert({
      where: { id: r.id },
      update: baseData,
      create: { id: r.id, ...baseData },
    });

    await prisma.reservationGuest.upsert({
      where: { id: r.reservationGuestId },
      update: { isPrimary: true },
      create: {
        id: r.reservationGuestId,
        tenantId: tenant.id,
        reservationId: r.id,
        guestId: r.guestId,
        isPrimary: true,
      },
    });

    // Folio: para las que están CHECKED_IN o CHECKED_OUT, creamos folio
    // con cargos básicos (alojamiento + minibar). Para las CONFIRMED /
    // PENDING no creamos folio aún (lo hace el check-in real).
    if (r.checkedIn) {
      const folio = await prisma.folio.upsert({
        where: { reservationId: r.id },
        update: {
          status: r.checkedOut ? FolioStatus.CLOSED : FolioStatus.OPEN,
          closedAt: r.checkedOut ? checkedOutAt : null,
        },
        create: {
          tenantId: tenant.id,
          reservationId: r.id,
          status: r.checkedOut ? FolioStatus.CLOSED : FolioStatus.OPEN,
          balance: r.checkedOut ? 0 : r.totalAmount,
          currency: 'EUR',
          closedAt: r.checkedOut ? checkedOutAt : null,
        },
      });

      const chargeIdempotency = `seed-${r.id}-room`;
      await prisma.folioEntry.upsert({
        where: {
          folioId_idempotencyKey: { folioId: folio.id, idempotencyKey: chargeIdempotency },
        },
        update: {},
        create: {
          tenantId: tenant.id,
          folioId: folio.id,
          type: 'CHARGE',
          description: `Alojamiento ${r.code}`,
          amount: r.totalAmount,
          currency: 'EUR',
          idempotencyKey: chargeIdempotency,
        },
      });

      if (r.checkedOut) {
        // Pago de cierre — folio CLOSED requiere balance = 0.
        await prisma.folioEntry.upsert({
          where: {
            folioId_idempotencyKey: {
              folioId: folio.id,
              idempotencyKey: `seed-${r.id}-pay`,
            },
          },
          update: {},
          create: {
            tenantId: tenant.id,
            folioId: folio.id,
            type: 'PAYMENT',
            description: 'Pago tarjeta cierre',
            amount: -r.totalAmount,
            currency: 'EUR',
            idempotencyKey: `seed-${r.id}-pay`,
          },
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // Housekeeping tasks para HOY (lo que la PWA enseña al entrar)
  // ------------------------------------------------------------------
  const hskTasks: Array<{
    id: string;
    roomNumber: string;
    taskType: HousekeepingTaskType;
    status: HousekeepingTaskStatus;
    /** Offset desde hoy para businessDate. 0 = hoy. */
    dayOffset: number;
    assignedTo?: string;
    durationMin?: number;
    completed?: boolean;
  }> = [
    // 2 CHECKOUT_CLEAN pendientes en plantas distintas — la habitación 102
    // se acaba de quedar libre tras el check-out de ayer.
    {
      id: '22222222-2222-2222-2222-22222222200a',
      roomNumber: '102',
      taskType: HousekeepingTaskType.CHECKOUT_CLEAN,
      status: HousekeepingTaskStatus.PENDING,
      dayOffset: 0,
      assignedTo: USER_IDS.hsk1,
    },
    {
      id: '22222222-2222-2222-2222-22222222200b',
      roomNumber: '201',
      taskType: HousekeepingTaskType.CHECKOUT_CLEAN,
      status: HousekeepingTaskStatus.PENDING,
      dayOffset: 0,
      assignedTo: USER_IDS.hsk2,
    },
    // 1 STAYOVER_CLEAN para in-house de hoy.
    {
      id: '22222222-2222-2222-2222-22222222200c',
      roomNumber: '101',
      taskType: HousekeepingTaskType.STAYOVER_CLEAN,
      status: HousekeepingTaskStatus.PENDING,
      dayOffset: 0,
      assignedTo: USER_IDS.hsk3,
    },
    // 1 INSPECTION pendiente.
    {
      id: '22222222-2222-2222-2222-22222222200d',
      roomNumber: '301',
      taskType: HousekeepingTaskType.INSPECTION,
      status: HousekeepingTaskStatus.PENDING,
      dayOffset: 0,
      assignedTo: USER_IDS.hskSup,
    },
    // 1 STAYOVER_CLEAN ya completada de ayer — para que el histórico
    // tenga datos.
    {
      id: '22222222-2222-2222-2222-22222222200e',
      roomNumber: '101',
      taskType: HousekeepingTaskType.STAYOVER_CLEAN,
      status: HousekeepingTaskStatus.COMPLETED,
      dayOffset: -1,
      assignedTo: USER_IDS.hsk4,
      durationMin: 22,
      completed: true,
    },
  ];

  for (const t of hskTasks) {
    const roomId = roomsByNumber.get(t.roomNumber);
    if (!roomId) continue;
    const businessDate = addDays(today, t.dayOffset);
    const completedAt = t.completed ? addDays(businessDate, 0) : null;
    await prisma.housekeepingTask.upsert({
      where: { id: t.id },
      update: { status: t.status, businessDate, assignedToUserId: t.assignedTo },
      create: {
        id: t.id,
        tenantId: tenant.id,
        propertyId: property.id,
        roomId,
        businessDate,
        taskType: t.taskType,
        status: t.status,
        assignedToUserId: t.assignedTo,
        assignedAt: t.assignedTo ? new Date() : null,
        startedAt: t.completed ? businessDate : null,
        completedAt,
        durationMin: t.durationMin ?? null,
      },
    });
  }

  console.error('Piloto seed completed:');
  console.error({
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    propertyId: property.id,
    propertyCode: property.code,
    propertyPublishedAs: '/h/berenjena',
    roomTypes: Object.fromEntries(ROOM_TYPES.map((rt) => [rt.key, roomTypeIds[rt.key]])),
    rooms: ROOMS.length,
    ratePlanId: ratePlan.id,
    users: USERS.length,
    guests: GUESTS.length,
    reservations: RESERVATIONS.length,
    hskTasks: hskTasks.length,
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
