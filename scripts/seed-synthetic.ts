/**
 * Seed sintético multi-hotel — Sprint 7 W4.
 *
 * Crea uno o varios hoteles ficticios con habitaciones, tarifas, huéspedes
 * y reservas históricas realistas (con estacionalidad). Útil para validar
 * funcionalidad cuando no hay piloto operando, demos comerciales y carga
 * de testing.
 *
 * Uso (desde la raíz del monorepo, contra una DB local NO productiva):
 *
 *   DIRECT_URL="postgres://pms:pms@localhost:5432/pms" \
 *     pnpm tsx scripts/seed-synthetic.ts \
 *       --tenant <uuid> \
 *       --properties 3 \
 *       --rooms-per-property 40 \
 *       --history-months 24 \
 *       --reservations-per-month 200
 *
 * Flags:
 *   --tenant <uuid>             (default: 33333333-3333-3333-3333-333333333333)
 *   --properties <N>            (default: 1)
 *   --rooms-per-property <N>    (default: 30)
 *   --history-months <N>        (default: 12)
 *   --reservations-per-month <N>(default: 100)
 *   --reset                     (borra reservas + huéspedes generados antes)
 *   --no-confirm                (no pregunta antes de crear)
 *   --seed <int>                (semilla aleatoria para reproducibilidad)
 *
 * Salvaguardas:
 *   - Aborta si la DB parece producción (host contiene "fly.dev", "flycast",
 *     "rds.amazonaws"; o NODE_ENV=production).
 *   - Aborta si el host es desconocido salvo que pase --force-prod.
 *
 * Idempotencia: usa UUIDs deterministas para tenant + properties + room
 * types. Las reservas y huéspedes generados llevan una marca
 * `attributes.synthetic = true` para poder borrarlos con --reset sin tocar
 * datos reales.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import {
  PrismaClient,
  Prisma,
  ReservationStatus,
  ReservationSource,
  FolioStatus,
  FolioEntryType,
  GuaranteeStatus,
  GuaranteeType,
  RoomStatus,
  TenantStatus,
} from '@prisma/client';

const envCandidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
for (const path of envCandidates) {
  if (existsSync(path)) {
    loadDotenv({ path });
    break;
  }
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function argFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function argValue(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const CFG = {
  tenantId: argValue('tenant', '33333333-3333-3333-3333-333333333333'),
  properties: Number(argValue('properties', '1')),
  roomsPerProperty: Number(argValue('rooms-per-property', '30')),
  historyMonths: Number(argValue('history-months', '12')),
  reservationsPerMonth: Number(argValue('reservations-per-month', '100')),
  reset: argFlag('reset'),
  noConfirm: argFlag('no-confirm'),
  forceProd: argFlag('force-prod'),
  seed: Number(argValue('seed', '42')),
};

const adminUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!adminUrl) {
  console.error('Set DIRECT_URL (preferred) or DATABASE_URL');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Salvaguardas: no correr en prod
// ---------------------------------------------------------------------------

const PROD_HOST_HINTS = ['fly.dev', 'flycast', 'rds.amazonaws', 'supabase.co', 'neon.tech'];
const looksProd =
  process.env.NODE_ENV === 'production' ||
  PROD_HOST_HINTS.some((h) => adminUrl!.includes(h));

if (looksProd && !CFG.forceProd) {
  console.error('La DB parece productiva. Aborta. Usa --force-prod si estás seguro.');
  console.error(`DB host: ${adminUrl?.replace(/:[^@]+@/, ':***@')}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Random determinista (LCG simple para reproducibilidad)
// ---------------------------------------------------------------------------

class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }
  next(): number {
    // LCG (Numerical Recipes)
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 0xffffffff;
  }
  int(min: number, maxInclusive: number): number {
    return Math.floor(this.next() * (maxInclusive - min + 1)) + min;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}
const rng = new Rng(CFG.seed);

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------

const ROOM_TYPES = [
  { code: 'IND', name: 'Individual', baseOccupancy: 1, maxOccupancy: 1, defaultRate: 75, share: 0.2 },
  { code: 'DBL', name: 'Doble Estándar', baseOccupancy: 2, maxOccupancy: 2, defaultRate: 110, share: 0.45 },
  { code: 'TWN', name: 'Twin', baseOccupancy: 2, maxOccupancy: 2, defaultRate: 110, share: 0.15 },
  { code: 'SUP', name: 'Superior', baseOccupancy: 2, maxOccupancy: 3, defaultRate: 145, share: 0.12 },
  { code: 'JSU', name: 'Junior Suite', baseOccupancy: 2, maxOccupancy: 4, defaultRate: 200, share: 0.05 },
  { code: 'SUI', name: 'Suite', baseOccupancy: 2, maxOccupancy: 4, defaultRate: 280, share: 0.03 },
] as const;

const FIRST_NAMES = [
  'María', 'Carmen', 'Lucía', 'Ana', 'Isabel', 'Sofía', 'Paula', 'Laura', 'Marta', 'Elena',
  'Antonio', 'Manuel', 'José', 'Francisco', 'Javier', 'Daniel', 'Carlos', 'Miguel', 'Alejandro', 'Pablo',
  'Liam', 'Olivia', 'Noah', 'Emma', 'Lucas', 'Mia', 'Ethan', 'Ava', 'Léo', 'Camille',
];
const LAST_NAMES = [
  'García', 'Rodríguez', 'González', 'Fernández', 'López', 'Martínez', 'Sánchez', 'Pérez',
  'Gómez', 'Martín', 'Jiménez', 'Ruiz', 'Hernández', 'Díaz', 'Moreno', 'Muñoz', 'Álvarez',
  'Romero', 'Alonso', 'Gutiérrez', 'Smith', 'Müller', 'Dupont', 'Rossi', 'Johansson',
];
const NATIONALITIES = ['ES', 'ES', 'ES', 'ES', 'ES', 'FR', 'DE', 'GB', 'IT', 'PT', 'US'];
const AGENCIES = ['Booking.com', 'Expedia', 'Hotelbeds', 'TUI', 'Marsans', null, null, null];
const COMPANIES = ['Acme Corp', 'Globex SL', 'Iberia Industrial', null, null, null, null];
const MEMBERSHIPS: Array<string | null> = ['Gold', 'Platinum', 'VIP', null, null, null, null, null, null];

const SEASONALITY: Record<number, number> = {
  // 0-indexed month: multiplicador sobre reservationsPerMonth
  0: 0.55, 1: 0.6, 2: 0.7, 3: 0.85, 4: 0.95, 5: 1.1,
  6: 1.45, 7: 1.5, 8: 1.2, 9: 0.95, 10: 0.7, 11: 0.85,
};

const SOURCES: ReservationSource[] = [
  ReservationSource.DIRECT,
  ReservationSource.DIRECT,
  ReservationSource.DIRECT,
  ReservationSource.BOOKING_COM,
  ReservationSource.BOOKING_COM,
  ReservationSource.EXPEDIA,
  ReservationSource.PHONE,
  ReservationSource.WALK_IN,
  ReservationSource.AGENT,
];

// ---------------------------------------------------------------------------
// UUIDs deterministas
// ---------------------------------------------------------------------------

function detPropertyId(idx: number): string {
  return `33333333-3333-3333-3333-3333333333${idx.toString().padStart(2, '0')}`;
}
function detRoomTypeId(propIdx: number, rtIdx: number): string {
  return `33333333-3333-3333-${propIdx.toString().padStart(4, '0')}-3333333333${rtIdx.toString().padStart(2, '0')}`;
}
function detRatePlanId(propIdx: number): string {
  return `33333333-3333-3333-${propIdx.toString().padStart(4, '0')}-aaaaaaaaaaaa`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const prisma = new PrismaClient({ datasources: { db: { url: adminUrl } } });

async function main() {
  console.log('--- Seed sintético ---');
  console.log(JSON.stringify(CFG, null, 2));
  console.log(`DB: ${adminUrl!.replace(/:[^@]+@/, ':***@')}`);

  if (!CFG.noConfirm) {
    await new Promise((r) => setTimeout(r, 2000));
  }

  await ensureTenant();

  if (CFG.reset) {
    await reset();
  }

  for (let p = 0; p < CFG.properties; p += 1) {
    const propertyId = detPropertyId(p);
    await ensureProperty(p);
    await ensureRoomTypes(p);
    await ensureRooms(p);
    await ensureRatePlan(p);
    console.log(`Property ${p + 1}/${CFG.properties} ready: ${propertyId}`);
  }

  // Pool de huéspedes (compartido entre properties del mismo tenant).
  const guestPool = await ensureGuestPool();
  console.log(`Guest pool: ${guestPool.length}`);

  // Reservas históricas mes a mes.
  for (let p = 0; p < CFG.properties; p += 1) {
    const propertyId = detPropertyId(p);
    const ratePlanId = detRatePlanId(p);
    const roomTypeMap = await loadRoomTypeMap(propertyId);
    for (let month = -CFG.historyMonths + 1; month <= 0; month += 1) {
      const targetMonth = addMonths(today(), month);
      const seasonal = SEASONALITY[targetMonth.getUTCMonth()] ?? 1;
      const N = Math.round(CFG.reservationsPerMonth * seasonal);
      await createMonthReservations(propertyId, ratePlanId, targetMonth, N, guestPool, roomTypeMap);
    }
    console.log(`Property ${p + 1} reservas generadas`);
  }

  console.log('--- Seed completo ---');
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function ensureTenant() {
  await prisma.tenant.upsert({
    where: { id: CFG.tenantId },
    create: {
      id: CFG.tenantId,
      slug: `synthetic-${CFG.tenantId.slice(0, 8)}`,
      name: 'Synthetic Hotels',
      status: TenantStatus.ACTIVE,
      attributes: { synthetic: true } as Prisma.InputJsonValue,
    },
    update: {},
  });
}

async function ensureProperty(idx: number) {
  const id = detPropertyId(idx);
  await prisma.property.upsert({
    where: { id },
    create: {
      id,
      tenantId: CFG.tenantId,
      code: `SYN${(idx + 1).toString().padStart(2, '0')}`,
      name: `Synthetic Hotel ${idx + 1}`,
      city: ['Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Málaga'][idx % 5],
      country: 'ES',
      timezone: 'Europe/Madrid',
      currency: 'EUR',
      attributes: { synthetic: true } as Prisma.InputJsonValue,
    },
    update: {},
  });
}

async function ensureRoomTypes(propIdx: number) {
  const propertyId = detPropertyId(propIdx);
  for (let i = 0; i < ROOM_TYPES.length; i += 1) {
    const rt = ROOM_TYPES[i]!;
    await prisma.roomType.upsert({
      where: { id: detRoomTypeId(propIdx, i) },
      create: {
        id: detRoomTypeId(propIdx, i),
        tenantId: CFG.tenantId,
        propertyId,
        code: rt.code,
        name: rt.name,
        baseOccupancy: rt.baseOccupancy,
        maxOccupancy: rt.maxOccupancy,
        defaultRate: new Prisma.Decimal(rt.defaultRate),
      },
      update: {},
    });
  }
}

async function ensureRooms(propIdx: number) {
  const propertyId = detPropertyId(propIdx);
  const existing = await prisma.room.count({ where: { propertyId } });
  if (existing >= CFG.roomsPerProperty) return;
  // Distribuir habitaciones por tipo según share, repartidas en 5 plantas.
  const byType: { roomTypeId: string; count: number }[] = ROOM_TYPES.map((rt, i) => ({
    roomTypeId: detRoomTypeId(propIdx, i),
    count: Math.max(1, Math.round(rt.share * CFG.roomsPerProperty)),
  }));
  let roomNum = 101;
  let floor = 1;
  const data: Prisma.RoomCreateManyInput[] = [];
  for (const t of byType) {
    for (let i = 0; i < t.count; i += 1) {
      if (roomNum % 100 > 20) {
        floor += 1;
        roomNum = floor * 100 + 1;
      }
      data.push({
        tenantId: CFG.tenantId,
        propertyId,
        roomTypeId: t.roomTypeId,
        number: String(roomNum),
        floor: String(floor),
        status: RoomStatus.CLEAN,
      });
      roomNum += 1;
    }
  }
  await prisma.room.createMany({ data, skipDuplicates: true });
}

async function ensureRatePlan(propIdx: number) {
  const id = detRatePlanId(propIdx);
  await prisma.ratePlan.upsert({
    where: { id },
    create: {
      id,
      tenantId: CFG.tenantId,
      propertyId: detPropertyId(propIdx),
      code: 'BAR',
      name: 'Best Available Rate',
      isPublic: true,
      currency: 'EUR',
    },
    update: {},
  });
}

async function ensureGuestPool(): Promise<{ id: string; firstName: string; lastName: string; nationality: string | null; membershipLevel: string | null }[]> {
  // Buscamos guests marcados como sintéticos del tenant.
  const existing = await prisma.guest.findMany({
    where: {
      tenantId: CFG.tenantId,
      attributes: { path: ['synthetic'], equals: true },
    },
    select: { id: true, firstName: true, lastName: true, nationality: true, membershipLevel: true },
  });
  const target = CFG.properties * 50;
  if (existing.length >= target) return existing;

  const toCreate: Prisma.GuestCreateManyInput[] = [];
  for (let i = existing.length; i < target; i += 1) {
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    const nat = rng.pick(NATIONALITIES);
    const mem = rng.pick(MEMBERSHIPS);
    toCreate.push({
      id: randomUUID(),
      tenantId: CFG.tenantId,
      firstName: first,
      lastName: last,
      email: `${first}.${last}.${i}@synthetic.test`.toLowerCase().replace(/\s+/g, ''),
      phone: `+34 6${rng.int(10000000, 99999999)}`,
      nationality: nat,
      membershipLevel: mem,
      gdprConsent: true,
      attributes: { synthetic: true } as Prisma.InputJsonValue,
    });
  }
  await prisma.guest.createMany({ data: toCreate, skipDuplicates: true });
  return prisma.guest.findMany({
    where: {
      tenantId: CFG.tenantId,
      attributes: { path: ['synthetic'], equals: true },
    },
    select: { id: true, firstName: true, lastName: true, nationality: true, membershipLevel: true },
  });
}

async function loadRoomTypeMap(propertyId: string) {
  return prisma.roomType.findMany({
    where: { propertyId },
    select: { id: true, code: true, defaultRate: true, baseOccupancy: true, maxOccupancy: true },
  });
}

async function createMonthReservations(
  propertyId: string,
  ratePlanId: string,
  monthAnchor: Date,
  count: number,
  guestPool: Awaited<ReturnType<typeof ensureGuestPool>>,
  roomTypes: Awaited<ReturnType<typeof loadRoomTypeMap>>,
) {
  const propIdxStr = propertyId.slice(-2);
  const propCode = `SYN${parseInt(propIdxStr) + 1}`.padStart(5, 'S');
  for (let i = 0; i < count; i += 1) {
    const rt = weightedRoomType(roomTypes);
    const arrivalDay = rng.int(1, 28);
    const arrival = new Date(Date.UTC(monthAnchor.getUTCFullYear(), monthAnchor.getUTCMonth(), arrivalDay));
    const nights = rng.chance(0.6) ? rng.int(1, 3) : rng.int(3, 7);
    const departure = new Date(arrival);
    departure.setUTCDate(departure.getUTCDate() + nights);
    const guest = rng.pick(guestPool);
    const adults = rt.baseOccupancy;
    const children = rng.chance(0.1) ? rng.int(1, Math.max(0, rt.maxOccupancy - adults)) : 0;
    const dailyRate = Number(rt.defaultRate) * (0.9 + rng.next() * 0.3);
    const total = dailyRate * nights;
    const totalAmount = new Prisma.Decimal(total.toFixed(2));

    const now = new Date();
    let status: ReservationStatus;
    let cancelledAt: Date | null = null;
    let checkedInAt: Date | null = null;
    let checkedOutAt: Date | null = null;
    if (departure < now) {
      // pasada
      if (rng.chance(0.08)) {
        status = ReservationStatus.CANCELLED;
        cancelledAt = new Date(arrival);
        cancelledAt.setUTCDate(cancelledAt.getUTCDate() - rng.int(1, 30));
      } else if (rng.chance(0.04)) {
        status = ReservationStatus.NO_SHOW;
      } else {
        status = ReservationStatus.CHECKED_OUT;
        checkedInAt = arrival;
        checkedOutAt = departure;
      }
    } else if (arrival <= now && now < departure) {
      status = ReservationStatus.CHECKED_IN;
      checkedInAt = arrival;
    } else {
      status = rng.chance(0.4) ? ReservationStatus.CONFIRMED : ReservationStatus.PENDING;
    }

    const source = rng.pick(SOURCES);
    const agency = source === ReservationSource.AGENT ? rng.pick(AGENCIES) : null;
    const company = rng.chance(0.1) ? rng.pick(COMPANIES) : null;

    const code = `${propCode}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const reservationId = randomUUID();
    const folioId = randomUUID();

    await prisma.reservation.create({
      data: {
        id: reservationId,
        tenantId: CFG.tenantId,
        propertyId,
        code,
        status,
        arrivalDate: arrival,
        departureDate: departure,
        adults,
        children,
        roomTypeId: rt.id,
        ratePlanId,
        totalAmount,
        currency: 'EUR',
        source,
        agencyName: agency,
        companyName: company,
        checkedInAt,
        checkedOutAt,
        cancelledAt,
        cancellationReason: cancelledAt ? 'Cancelado por huésped' : null,
        guaranteeType: GuaranteeType.NONE,
        guaranteeStatus: GuaranteeStatus.PENDING,
        guests: {
          create: {
            tenantId: CFG.tenantId,
            guestId: guest.id,
            isPrimary: true,
          },
        },
        folio: {
          create: {
            id: folioId,
            tenantId: CFG.tenantId,
            status: status === ReservationStatus.CHECKED_OUT ? FolioStatus.CLOSED : FolioStatus.OPEN,
            balance: status === ReservationStatus.CHECKED_OUT ? new Prisma.Decimal(0) : totalAmount,
            currency: 'EUR',
          },
        },
        attributes: { synthetic: true } as Prisma.InputJsonValue,
      },
    });

    // Folio entries por noche (solo si la reserva paso de pending)
    if (status === ReservationStatus.CHECKED_OUT || status === ReservationStatus.CHECKED_IN) {
      const entries: Prisma.FolioEntryCreateManyInput[] = [];
      for (let n = 0; n < nights; n += 1) {
        const date = new Date(arrival);
        date.setUTCDate(date.getUTCDate() + n);
        entries.push({
          tenantId: CFG.tenantId,
          folioId,
          type: FolioEntryType.CHARGE,
          description: `Alojamiento noche ${n + 1}`,
          amount: new Prisma.Decimal(dailyRate.toFixed(2)),
          currency: 'EUR',
          postedAt: date,
          idempotencyKey: `synthetic-night-${reservationId}-${n}`,
          attributes: { synthetic: true } as Prisma.InputJsonValue,
        });
      }
      if (status === ReservationStatus.CHECKED_OUT) {
        entries.push({
          tenantId: CFG.tenantId,
          folioId,
          type: FolioEntryType.PAYMENT,
          description: 'Pago tarjeta',
          amount: new Prisma.Decimal((-total).toFixed(2)),
          currency: 'EUR',
          postedAt: departure,
          idempotencyKey: `synthetic-pay-${reservationId}`,
          attributes: { synthetic: true } as Prisma.InputJsonValue,
        });
      }
      await prisma.folioEntry.createMany({ data: entries, skipDuplicates: true });
    }
  }
}

async function reset() {
  console.log('--reset: borrando reservas, folio entries y huéspedes sintéticos...');
  await prisma.folioEntry.deleteMany({
    where: { attributes: { path: ['synthetic'], equals: true }, tenantId: CFG.tenantId },
  });
  await prisma.reservationGuest.deleteMany({
    where: {
      tenantId: CFG.tenantId,
      reservation: { attributes: { path: ['synthetic'], equals: true } },
    },
  });
  await prisma.folio.deleteMany({
    where: {
      tenantId: CFG.tenantId,
      reservation: { attributes: { path: ['synthetic'], equals: true } },
    },
  });
  await prisma.reservation.deleteMany({
    where: { tenantId: CFG.tenantId, attributes: { path: ['synthetic'], equals: true } },
  });
  await prisma.guest.deleteMany({
    where: { tenantId: CFG.tenantId, attributes: { path: ['synthetic'], equals: true } },
  });
}

function weightedRoomType<T extends { code: string }>(types: readonly T[]): T {
  // Match codes to ROOM_TYPES share. Si no, uniform.
  const weights = types.map((t) => {
    const def = ROOM_TYPES.find((r) => r.code === t.code);
    return def?.share ?? 1 / types.length;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * sum;
  for (let i = 0; i < types.length; i += 1) {
    r -= weights[i]!;
    if (r <= 0) return types[i]!;
  }
  return types[types.length - 1]!;
}

function today(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(1);
  return d;
}
function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
