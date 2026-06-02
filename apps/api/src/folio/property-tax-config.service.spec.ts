import { NotFoundException } from '@nestjs/common';
import { Prisma, TaxCategory } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth';
import { PropertyTaxConfigService } from './property-tax-config.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';

const user: AuthUser = {
  sub: USER_ID,
  tenantId: TENANT_ID,
  email: 'admin@hotel.test',
  roles: ['tenant_admin'],
};

function buildService(opts: {
  rows?: Array<{ category: TaxCategory; taxRate: string; effectiveFrom: Date }>;
  propertyExists?: boolean;
}) {
  const rows = (opts.rows ?? []).map((r) => ({
    category: r.category,
    taxRate: new Prisma.Decimal(r.taxRate),
    effectiveFrom: r.effectiveFrom,
  }));

  const tx = {
    propertyTaxConfig: {
      findMany: vi.fn().mockResolvedValue(rows),
      findFirst: vi.fn().mockImplementation(({ where }: { where: { category: TaxCategory } }) => {
        return Promise.resolve(rows.find((r) => r.category === where.category) ?? null);
      }),
      upsert: vi
        .fn()
        .mockImplementation(({ create, update }: { create: never; update: never }) => {
          const c = create as { category: TaxCategory; taxRate: Prisma.Decimal };
          const u = update as { taxRate?: Prisma.Decimal };
          return Promise.resolve({
            category: c.category,
            taxRate: u.taxRate ?? c.taxRate,
            effectiveFrom: new Date(),
          });
        }),
    },
    property: {
      findFirst: vi.fn().mockResolvedValue(
        opts.propertyExists === false ? null : { id: PROPERTY_ID },
      ),
    },
  };
  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return {
    service: new PropertyTaxConfigService(prisma as never),
    tx,
  };
}

describe('PropertyTaxConfigService.getMatrix', () => {
  it('devuelve sólo la última fila por categoría', async () => {
    const old = new Date('2026-01-01');
    const recent = new Date('2026-06-01');
    const { service } = buildService({
      rows: [
        // Devueltas en orden category ASC, effectiveFrom DESC (el service confía en
        // ese orden para coger la primera por categoría).
        { category: TaxCategory.ROOM, taxRate: '10.00', effectiveFrom: recent },
        { category: TaxCategory.ROOM, taxRate: '8.00', effectiveFrom: old },
        { category: TaxCategory.EXTRA_OTHER, taxRate: '21.00', effectiveFrom: recent },
      ],
    });
    const out = await service.getMatrix(user, 'corr', PROPERTY_ID);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.category === TaxCategory.ROOM)?.taxRate).toBe('10');
    expect(out.find((r) => r.category === TaxCategory.EXTRA_OTHER)?.taxRate).toBe('21');
  });

  it('devuelve array vacío si la property no tiene config', async () => {
    const { service } = buildService({ rows: [] });
    const out = await service.getMatrix(user, 'corr', PROPERTY_ID);
    expect(out).toEqual([]);
  });
});

describe('PropertyTaxConfigService.upsertRate', () => {
  it('crea o actualiza el rate del día y devuelve el row', async () => {
    const { service, tx } = buildService({ rows: [] });
    const out = await service.upsertRate(user, 'corr', PROPERTY_ID, TaxCategory.ROOM, 10);
    expect(out.category).toBe(TaxCategory.ROOM);
    expect(out.taxRate).toBe('10');
    expect(tx.propertyTaxConfig.upsert).toHaveBeenCalledOnce();
  });

  it('lanza NotFound si la property no existe (o pertenece a otro tenant)', async () => {
    const { service } = buildService({ rows: [], propertyExists: false });
    await expect(
      service.upsertRate(user, 'corr', PROPERTY_ID, TaxCategory.ROOM, 10),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PropertyTaxConfigService.resolveRate', () => {
  it('devuelve la última fila vigente para (property, category)', async () => {
    const { service, tx } = buildService({
      rows: [
        { category: TaxCategory.ROOM, taxRate: '10.00', effectiveFrom: new Date() },
      ],
    });
    // Llamada interna desde FolioService: pasamos tx directamente.
    const rate = await service.resolveRate(
      tx as never,
      PROPERTY_ID,
      TaxCategory.ROOM,
    );
    expect(rate?.toString()).toBe('10');
  });

  it('devuelve null si no hay config para la categoría', async () => {
    const { service, tx } = buildService({ rows: [] });
    const rate = await service.resolveRate(
      tx as never,
      PROPERTY_ID,
      TaxCategory.BREAKFAST,
    );
    expect(rate).toBeNull();
  });
});
