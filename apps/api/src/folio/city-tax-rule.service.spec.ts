import { NotFoundException } from '@nestjs/common';
import { CityTaxRegion, Prisma } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth';
import { CityTaxRuleService } from './city-tax-rule.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';

const user: AuthUser = {
  sub: USER_ID,
  email: 'admin@hotel.test',
  tenantId: TENANT_ID,
  roles: ['tenant_admin'],
};

const sampleRule = {
  propertyId: PROPERTY_ID,
  region: CityTaxRegion.CATALUNYA,
  amountPerNight: new Prisma.Decimal('1.20'),
  appliesToAdults: true,
  appliesToChildren: false,
  childAgeThreshold: 16,
  maxNights: 7,
};

function buildService(opts: {
  rule?: typeof sampleRule | null;
  propertyExists?: boolean;
}) {
  const tx = {
    cityTaxRule: {
      findUnique: vi.fn().mockResolvedValue(opts.rule ?? null),
      upsert: vi.fn().mockResolvedValue(opts.rule ?? sampleRule),
    },
    property: {
      findFirst: vi
        .fn()
        .mockResolvedValue(opts.propertyExists === false ? null : { id: PROPERTY_ID }),
    },
  };
  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return {
    service: new CityTaxRuleService(prisma as never),
    tx,
  };
}

describe('CityTaxRuleService.getRule', () => {
  it('devuelve la regla cuando existe', async () => {
    const { service } = buildService({ rule: sampleRule });
    const r = await service.getRule(user, 'corr', PROPERTY_ID);
    expect(r?.region).toBe(CityTaxRegion.CATALUNYA);
    expect(r?.amountPerNight).toBe('1.2');
  });

  it('devuelve null si no existe', async () => {
    const { service } = buildService({ rule: null });
    expect(await service.getRule(user, 'corr', PROPERTY_ID)).toBeNull();
  });
});

describe('CityTaxRuleService.upsertRule', () => {
  it('crea/actualiza la regla y devuelve DTO', async () => {
    const { service, tx } = buildService({ rule: null });
    const r = await service.upsertRule(user, 'corr', PROPERTY_ID, {
      region: CityTaxRegion.BALEARES,
      amountPerNight: 2.2,
      appliesToAdults: true,
      appliesToChildren: false,
      childAgeThreshold: 16,
      maxNights: 9,
    });
    expect(r.region).toBe(CityTaxRegion.CATALUNYA); // mock devuelve sampleRule
    expect(tx.cityTaxRule.upsert).toHaveBeenCalledOnce();
  });

  it('lanza NotFound si la property no existe', async () => {
    const { service } = buildService({ rule: null, propertyExists: false });
    await expect(
      service.upsertRule(user, 'corr', PROPERTY_ID, {
        region: CityTaxRegion.NONE,
        amountPerNight: 0,
        appliesToAdults: true,
        appliesToChildren: false,
        childAgeThreshold: 16,
        maxNights: 7,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
