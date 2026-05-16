import { describe, expect, it, vi } from 'vitest';
import {
  NightAuditAnomalyKind,
  NightAuditAnomalySeverity,
} from '@pms/db';
import { AnomalyService } from './anomaly.service';
import type { StepContext } from './step';

const USER_ID = '22222222-2222-2222-2222-222222222222';
const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';

function buildCtx(overrides: {
  queryRaw?: ReturnType<typeof vi.fn>;
  cashRecon?: ReturnType<typeof vi.fn>;
}): StepContext {
  const tx = {
    $queryRaw: overrides.queryRaw ?? vi.fn().mockResolvedValue([]),
    cashDrawerReconciliation: {
      findUnique: overrides.cashRecon ?? vi.fn().mockResolvedValue(null),
    },
  };
  return {
    tx: tx as never,
    user: { sub: USER_ID, tenantId: TENANT_ID, email: 'na@hotel.test', roles: ['night_auditor'] },
    correlationId: 'cid',
    runId: '44444444-4444-4444-4444-444444444444',
    propertyId: PROPERTY_ID,
    businessDate: '2026-06-10',
    businessDateAsDate: new Date('2026-06-10T00:00:00Z'),
  };
}

describe('AnomalyService', () => {
  it('detects DUPLICATE_CHARGE when idempotency_key has different amounts', async () => {
    const service = new AnomalyService();
    const queryRaw = vi
      .fn()
      // duplicate charges
      .mockResolvedValueOnce([
        { idempotency_key: 'dup-1', rows: 2, amounts: '100.00,150.00' },
      ])
      // deep discounts: empty
      .mockResolvedValueOnce([])
      // cancellation spree: empty
      .mockResolvedValueOnce([]);
    const ctx = buildCtx({ queryRaw });
    const out = await service.detectAll(ctx);
    const dup = out.find((a) => a.kind === NightAuditAnomalyKind.DUPLICATE_CHARGE);
    expect(dup).toBeDefined();
    expect(dup!.severity).toBe(NightAuditAnomalySeverity.CRITICAL);
  });

  it('detects CASH_DRAWER_VARIANCE when |discrepancy| / expected > 5%', async () => {
    const service = new AnomalyService();
    const cashRecon = vi.fn().mockResolvedValue({
      expectedAmount: 1000,
      countedAmount: 920,
      discrepancy: -80, // 8%
      currency: 'EUR',
    });
    const ctx = buildCtx({ cashRecon });
    const out = await service.detectAll(ctx);
    const variance = out.find((a) => a.kind === NightAuditAnomalyKind.CASH_DRAWER_VARIANCE);
    expect(variance).toBeDefined();
    expect(variance!.severity).toBe(NightAuditAnomalySeverity.HIGH);
    expect((variance!.details as { variancePct: number }).variancePct).toBe(8);
  });

  it('does NOT flag cash drawer when variance <= 5%', async () => {
    const service = new AnomalyService();
    const cashRecon = vi.fn().mockResolvedValue({
      expectedAmount: 1000,
      countedAmount: 970,
      discrepancy: -30, // 3%
      currency: 'EUR',
    });
    const ctx = buildCtx({ cashRecon });
    const out = await service.detectAll(ctx);
    expect(out.find((a) => a.kind === NightAuditAnomalyKind.CASH_DRAWER_VARIANCE)).toBeUndefined();
  });

  it('detects DEEP_DISCOUNT when discount >= 50% of charges', async () => {
    const service = new AnomalyService();
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([]) // duplicates
      .mockResolvedValueOnce([
        { folio_id: 'fff', charges: '100', discounts: '60' },
      ])
      .mockResolvedValueOnce([]); // cancellations
    const ctx = buildCtx({ queryRaw });
    const out = await service.detectAll(ctx);
    const deep = out.find((a) => a.kind === NightAuditAnomalyKind.DEEP_DISCOUNT);
    expect(deep).toBeDefined();
    expect(deep!.severity).toBe(NightAuditAnomalySeverity.MEDIUM);
    expect((deep!.details as { discountPct: number }).discountPct).toBe(60);
  });

  it('detects CANCELLATION_SPREE when same guest cancels > 3 times same day', async () => {
    const service = new AnomalyService();
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ guest_id: 'g-1', cancellations: 5 }]);
    const ctx = buildCtx({ queryRaw });
    const out = await service.detectAll(ctx);
    const spree = out.find((a) => a.kind === NightAuditAnomalyKind.CANCELLATION_SPREE);
    expect(spree).toBeDefined();
    expect(spree!.severity).toBe(NightAuditAnomalySeverity.MEDIUM);
  });

  it('returns empty array when nothing matches', async () => {
    const service = new AnomalyService();
    const ctx = buildCtx({});
    const out = await service.detectAll(ctx);
    expect(out).toEqual([]);
  });
});
