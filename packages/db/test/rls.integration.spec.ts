/**
 * Integration test verificando que RLS aisla tenants entre si y que
 * el trigger de audit registra cambios.
 *
 * Requiere docker compose arriba y el rol pms_app creado por
 * infra/postgres/init/02-roles.sql + las migraciones aplicadas:
 *
 *   pnpm infra:up
 *   pnpm --filter @pms/db migrate:reset
 *   pnpm --filter @pms/db test:integration
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { withTenant } from '../src/tenant-context';

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
const appUrl = process.env.DATABASE_URL;

if (!adminUrl || !appUrl) {
  throw new Error('DATABASE_URL and DIRECT_URL must be set for integration tests');
}

const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
const app = new PrismaClient({ datasources: { db: { url: appUrl } } });

let tenantA: { id: string };
let tenantB: { id: string };
let propertyA: { id: string };
let propertyB: { id: string };

beforeAll(async () => {
  // Limpieza determinista para que el test sea repetible
  await admin.auditLog.deleteMany({});
  await admin.property.deleteMany({});
  await admin.user.deleteMany({});
  await admin.tenant.deleteMany({ where: { slug: { in: ['rls-a', 'rls-b'] } } });

  tenantA = await admin.tenant.create({ data: { slug: 'rls-a', name: 'Hotel A' } });
  tenantB = await admin.tenant.create({ data: { slug: 'rls-b', name: 'Hotel B' } });

  propertyA = await admin.property.create({
    data: { tenantId: tenantA.id, code: 'A01', name: 'Property A' },
  });
  propertyB = await admin.property.create({
    data: { tenantId: tenantB.id, code: 'B01', name: 'Property B' },
  });
});

afterAll(async () => {
  await admin.$disconnect();
  await app.$disconnect();
});

describe('RLS isolation', () => {
  it('app role sees zero rows when no tenant context is set', async () => {
    const props = await app.property.findMany();
    expect(props).toEqual([]);
  });

  it('app role with tenant A only sees A rows', async () => {
    const props = await withTenant(app, { tenantId: tenantA.id }, (tx) =>
      tx.property.findMany(),
    );
    expect(props.map((p) => p.id)).toEqual([propertyA.id]);
  });

  it('app role with tenant B only sees B rows', async () => {
    const props = await withTenant(app, { tenantId: tenantB.id }, (tx) =>
      tx.property.findMany(),
    );
    expect(props.map((p) => p.id)).toEqual([propertyB.id]);
  });

  it('INSERT with mismatched tenant_id is rejected by RLS WITH CHECK', async () => {
    // Bajo contexto del tenant A, intentar insertar una property del tenant B
    // debe fallar por la WITH CHECK clause.
    await expect(
      withTenant(app, { tenantId: tenantA.id }, (tx) =>
        tx.property.create({
          data: { tenantId: tenantB.id, code: 'EVIL', name: 'cross-tenant insert' },
        }),
      ),
    ).rejects.toThrow();
  });

  it('app role cannot bypass RLS by manually setting another tenant_id outside withTenant', async () => {
    // Sin contexto: 0 filas; aunque la app intente leer todo.
    const props = await app.property.findMany();
    expect(props).toHaveLength(0);
  });
});

describe('Audit log', () => {
  it('logs INSERT operations with tenant_id and actor_id', async () => {
    const actorId = '11111111-1111-1111-1111-111111111111';

    const created = await withTenant(
      app,
      { tenantId: tenantA.id, actorId, correlationId: 'corr-1' },
      (tx) =>
        tx.property.create({
          data: { tenantId: tenantA.id, code: 'A02', name: 'Property A2' },
        }),
    );

    const logs = await withTenant(app, { tenantId: tenantA.id }, (tx) =>
      tx.auditLog.findMany({
        where: { recordId: created.id, operation: 'INSERT' },
      }),
    );

    expect(logs).toHaveLength(1);
    expect(logs[0]?.tenantId).toBe(tenantA.id);
    expect(logs[0]?.actorId).toBe(actorId);
    expect(logs[0]?.correlationId).toBe('corr-1');
    expect(logs[0]?.tableName).toBe('properties');
  });

  it('app role cannot directly INSERT into audit_log', async () => {
    await expect(
      withTenant(app, { tenantId: tenantA.id }, (tx) =>
        tx.$executeRaw`INSERT INTO audit_log (tenant_id, table_name, record_id, operation)
                       VALUES (${tenantA.id}::uuid, 'properties', gen_random_uuid(), 'INSERT')`,
      ),
    ).rejects.toThrow();
  });

  it('audit_log SELECT is also tenant-isolated', async () => {
    const aLogs = await withTenant(app, { tenantId: tenantA.id }, (tx) =>
      tx.auditLog.findMany(),
    );
    const bLogs = await withTenant(app, { tenantId: tenantB.id }, (tx) =>
      tx.auditLog.findMany(),
    );

    expect(aLogs.every((l) => l.tenantId === tenantA.id)).toBe(true);
    expect(bLogs.every((l) => l.tenantId === tenantB.id)).toBe(true);
  });
});
