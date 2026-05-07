/**
 * Import idempotente de datos del piloto (Sprint 5 W2).
 *
 * Lee un directorio con la siguiente estructura:
 *
 *   piloto-data/<slug>/
 *     manifest.json          { tenantId, propertyCode, propertyName, timezone, currency }
 *     room-types.jsonl       una linea JSON por tipo
 *     rooms.jsonl            una linea JSON por habitacion
 *     rate-plans.jsonl       una linea JSON por tarifa
 *
 * Cada paso es idempotente — re-correr el script con los mismos datos no
 * crea duplicados. Las claves naturales del schema actuan como upsert key:
 *   - Property:  (tenantId, code)
 *   - RoomType:  (tenantId, propertyId, code)
 *   - Room:      (tenantId, propertyId, number)
 *   - RatePlan:  (tenantId, propertyId, code)
 *
 * Uso:
 *   pnpm tsx scripts/import-piloto.ts --dir ./piloto-data/aubergine-bcn
 *   pnpm tsx scripts/import-piloto.ts --dir ./piloto-data/aubergine-bcn --dry-run
 *
 * Lo que NO hace este script (queda para PRs aparte):
 *   - Guests in-house actuales (datos personales sensibles, GDPR consent
 *     debe venir explicito en cada fila).
 *   - Reservaciones activas (pasan por flujos de check-in en la API real).
 *   - Folios o cargos historicos.
 *
 * Salida: en stdout, un resumen por entidad con counts de
 *   created / updated / skipped + reasons.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { PrismaClient, withTenant } from '@pms/db';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  dir: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let dir = '';
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--dir') {
      dir = argv[i + 1] ?? '';
      i += 1;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      printHelp();
      process.exit(2);
    }
  }
  if (!dir) {
    printHelp();
    process.exit(2);
  }
  return { dir: resolve(dir), dryRun };
}

function printHelp(): void {
  console.error('Usage: pnpm tsx scripts/import-piloto.ts --dir <path> [--dry-run]');
}

// ---------------------------------------------------------------------------
// Schemas (Zod)
// ---------------------------------------------------------------------------

const ManifestSchema = z.object({
  tenantId: z.string().uuid(),
  propertyCode: z.string().min(1).max(32),
  propertyName: z.string().min(1).max(200),
  timezone: z.string().min(1).default('Europe/Madrid'),
  currency: z.string().length(3).default('EUR'),
});
type Manifest = z.infer<typeof ManifestSchema>;

const RoomTypeRow = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  baseOccupancy: z.coerce.number().int().min(1).max(10).default(2),
  maxOccupancy: z.coerce.number().int().min(1).max(10).default(2),
  defaultRate: z.coerce.number().nonnegative().default(0),
  defaultCurrency: z.string().length(3).default('EUR'),
});
type RoomTypeRow = z.infer<typeof RoomTypeRow>;

const RoomRow = z.object({
  number: z.string().min(1).max(16),
  floor: z.string().max(8).optional(),
  roomTypeCode: z.string().min(1).max(32),
});
type RoomRow = z.infer<typeof RoomRow>;

const RatePlanRow = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  currency: z.string().length(3).default('EUR'),
});
type RatePlanRow = z.infer<typeof RatePlanRow>;

// ---------------------------------------------------------------------------
// JSONL reader
// ---------------------------------------------------------------------------

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const out: unknown[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`${path}:${i + 1}: invalid JSON — ${(err as Error).message}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reporters
// ---------------------------------------------------------------------------

interface StepReport {
  entity: string;
  created: number;
  updated: number;
  skipped: { row: number; reason: string }[];
}

function newReport(entity: string): StepReport {
  return { entity, created: 0, updated: 0, skipped: [] };
}

function printReport(reports: StepReport[]): void {
  console.log('\n=== Resumen ===');
  for (const r of reports) {
    const skipped = r.skipped.length;
    console.log(
      `${r.entity.padEnd(12)}  created=${r.created}  updated=${r.updated}  skipped=${skipped}`,
    );
    for (const s of r.skipped) {
      console.log(`  · linea ${s.row}: ${s.reason}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function upsertProperty(
  prisma: PrismaClient,
  manifest: Manifest,
  dryRun: boolean,
): Promise<{ propertyId: string; report: StepReport }> {
  const report = newReport('property');
  if (dryRun) {
    console.log(`[dry-run] property upsert ${manifest.propertyCode}`);
    return { propertyId: '00000000-0000-0000-0000-000000000000', report };
  }

  const propertyId = await withTenant(
    prisma,
    { tenantId: manifest.tenantId, actorId: null, correlationId: 'import-piloto' },
    async (tx) => {
      const existing = await tx.property.findFirst({
        where: { tenantId: manifest.tenantId, code: manifest.propertyCode, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        await tx.property.update({
          where: { id: existing.id },
          data: {
            name: manifest.propertyName,
            timezone: manifest.timezone,
            currency: manifest.currency,
          },
        });
        report.updated += 1;
        return existing.id;
      }
      const created = await tx.property.create({
        data: {
          tenantId: manifest.tenantId,
          code: manifest.propertyCode,
          name: manifest.propertyName,
          timezone: manifest.timezone,
          currency: manifest.currency,
        },
        select: { id: true },
      });
      report.created += 1;
      return created.id;
    },
  );

  return { propertyId, report };
}

async function upsertRoomTypes(
  prisma: PrismaClient,
  manifest: Manifest,
  propertyId: string,
  rows: unknown[],
  dryRun: boolean,
): Promise<{ idsByCode: Map<string, string>; report: StepReport }> {
  const report = newReport('room_types');
  const idsByCode = new Map<string, string>();

  for (let i = 0; i < rows.length; i += 1) {
    const parsed = RoomTypeRow.safeParse(rows[i]);
    if (!parsed.success) {
      report.skipped.push({ row: i + 1, reason: parsed.error.issues[0]!.message });
      continue;
    }
    const r = parsed.data;
    if (r.maxOccupancy < r.baseOccupancy) {
      report.skipped.push({ row: i + 1, reason: 'maxOccupancy < baseOccupancy' });
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] room_type upsert ${r.code}`);
      idsByCode.set(r.code, '00000000-0000-0000-0000-000000000000');
      continue;
    }

    await withTenant(
      prisma,
      { tenantId: manifest.tenantId, actorId: null, correlationId: 'import-piloto' },
      async (tx) => {
        const existing = await tx.roomType.findFirst({
          where: {
            tenantId: manifest.tenantId,
            propertyId,
            code: r.code,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (existing) {
          await tx.roomType.update({
            where: { id: existing.id },
            data: {
              name: r.name,
              description: r.description,
              baseOccupancy: r.baseOccupancy,
              maxOccupancy: r.maxOccupancy,
              defaultRate: r.defaultRate,
              defaultCurrency: r.defaultCurrency,
            },
          });
          idsByCode.set(r.code, existing.id);
          report.updated += 1;
        } else {
          const created = await tx.roomType.create({
            data: {
              tenantId: manifest.tenantId,
              propertyId,
              code: r.code,
              name: r.name,
              description: r.description,
              baseOccupancy: r.baseOccupancy,
              maxOccupancy: r.maxOccupancy,
              defaultRate: r.defaultRate,
              defaultCurrency: r.defaultCurrency,
            },
            select: { id: true },
          });
          idsByCode.set(r.code, created.id);
          report.created += 1;
        }
      },
    );
  }

  return { idsByCode, report };
}

async function upsertRooms(
  prisma: PrismaClient,
  manifest: Manifest,
  propertyId: string,
  roomTypeIdsByCode: Map<string, string>,
  rows: unknown[],
  dryRun: boolean,
): Promise<StepReport> {
  const report = newReport('rooms');

  for (let i = 0; i < rows.length; i += 1) {
    const parsed = RoomRow.safeParse(rows[i]);
    if (!parsed.success) {
      report.skipped.push({ row: i + 1, reason: parsed.error.issues[0]!.message });
      continue;
    }
    const r = parsed.data;
    const roomTypeId = roomTypeIdsByCode.get(r.roomTypeCode);
    if (!roomTypeId) {
      report.skipped.push({
        row: i + 1,
        reason: `roomTypeCode ${r.roomTypeCode} no encontrado (importa room-types.jsonl primero)`,
      });
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] room upsert ${r.number} (${r.roomTypeCode})`);
      continue;
    }

    await withTenant(
      prisma,
      { tenantId: manifest.tenantId, actorId: null, correlationId: 'import-piloto' },
      async (tx) => {
        const existing = await tx.room.findFirst({
          where: {
            tenantId: manifest.tenantId,
            propertyId,
            number: r.number,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (existing) {
          await tx.room.update({
            where: { id: existing.id },
            data: { roomTypeId, floor: r.floor },
          });
          report.updated += 1;
        } else {
          await tx.room.create({
            data: {
              tenantId: manifest.tenantId,
              propertyId,
              roomTypeId,
              number: r.number,
              floor: r.floor,
            },
          });
          report.created += 1;
        }
      },
    );
  }

  return report;
}

async function upsertRatePlans(
  prisma: PrismaClient,
  manifest: Manifest,
  propertyId: string,
  rows: unknown[],
  dryRun: boolean,
): Promise<StepReport> {
  const report = newReport('rate_plans');

  for (let i = 0; i < rows.length; i += 1) {
    const parsed = RatePlanRow.safeParse(rows[i]);
    if (!parsed.success) {
      report.skipped.push({ row: i + 1, reason: parsed.error.issues[0]!.message });
      continue;
    }
    const r = parsed.data;
    if (dryRun) {
      console.log(`[dry-run] rate_plan upsert ${r.code}`);
      continue;
    }

    await withTenant(
      prisma,
      { tenantId: manifest.tenantId, actorId: null, correlationId: 'import-piloto' },
      async (tx) => {
        const existing = await tx.ratePlan.findFirst({
          where: {
            tenantId: manifest.tenantId,
            propertyId,
            code: r.code,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (existing) {
          await tx.ratePlan.update({
            where: { id: existing.id },
            data: { name: r.name, description: r.description, currency: r.currency },
          });
          report.updated += 1;
        } else {
          await tx.ratePlan.create({
            data: {
              tenantId: manifest.tenantId,
              propertyId,
              code: r.code,
              name: r.name,
              description: r.description,
              currency: r.currency,
            },
          });
          report.created += 1;
        }
      },
    );
  }

  return report;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const envCandidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
  for (const path of envCandidates) {
    if (existsSync(path)) {
      loadDotenv({ path });
      break;
    }
  }

  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.dir)) {
    console.error(`Directorio no encontrado: ${args.dir}`);
    process.exit(2);
  }

  const manifestPath = resolve(args.dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`Falta manifest.json en ${args.dir}`);
    process.exit(2);
  }
  const manifest = ManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));

  const roomTypeRows = readJsonl(resolve(args.dir, 'room-types.jsonl'));
  const roomRows = readJsonl(resolve(args.dir, 'rooms.jsonl'));
  const ratePlanRows = readJsonl(resolve(args.dir, 'rate-plans.jsonl'));

  console.log(
    `Importando piloto: tenant=${manifest.tenantId} property=${manifest.propertyCode} dryRun=${args.dryRun}`,
  );
  console.log(
    `  room-types: ${roomTypeRows.length}  rooms: ${roomRows.length}  rate-plans: ${ratePlanRows.length}`,
  );

  const prisma = new PrismaClient();
  try {
    const reports: StepReport[] = [];
    const { propertyId, report: propertyReport } = await upsertProperty(
      prisma,
      manifest,
      args.dryRun,
    );
    reports.push(propertyReport);

    const { idsByCode, report: roomTypesReport } = await upsertRoomTypes(
      prisma,
      manifest,
      propertyId,
      roomTypeRows,
      args.dryRun,
    );
    reports.push(roomTypesReport);

    reports.push(await upsertRooms(prisma, manifest, propertyId, idsByCode, roomRows, args.dryRun));

    reports.push(await upsertRatePlans(prisma, manifest, propertyId, ratePlanRows, args.dryRun));

    printReport(reports);

    const totalSkipped = reports.reduce((acc, r) => acc + r.skipped.length, 0);
    if (totalSkipped > 0) {
      console.error(`\n[!] ${totalSkipped} fila(s) saltada(s). Corrige y re-corre el import.`);
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
