import { describe, expect, it, vi, afterEach } from 'vitest';
import { CleanupOrphanTenantsStep } from './cleanup-orphan-tenants';
import type { StepContext } from '../step';

afterEach(() => vi.useRealTimers());

function buildCtx(updateCount: number) {
  const updateMany = vi.fn().mockResolvedValue({ count: updateCount });
  const ctx = {
    tx: { tenant: { updateMany } },
    user: { tenantId: 't-1', sub: 'u-1' },
    correlationId: 'c',
    runId: 'r',
    propertyId: 'p',
    businessDate: '2026-06-10',
    businessDateAsDate: new Date('2026-06-10'),
  } as unknown as StepContext;
  return { ctx, updateMany };
}

describe('CleanupOrphanTenantsStep', () => {
  it('skips when ttlDays = 0', async () => {
    const { ctx, updateMany } = buildCtx(0);
    const step = new CleanupOrphanTenantsStep(0);
    const out = await step.run(ctx);
    expect(updateMany).not.toHaveBeenCalled();
    expect(out.totals?.deletedOrphanTenants).toBe(0);
    expect((out.result as { skipped: boolean }).skipped).toBe(true);
  });

  it('soft-deletes tenants matching the where clause', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T00:00:00Z'));
    const { ctx, updateMany } = buildCtx(3);
    const step = new CleanupOrphanTenantsStep(7);
    const out = await step.run(ctx);
    expect(updateMany).toHaveBeenCalledOnce();
    const args = updateMany.mock.calls[0]![0]!;
    expect(args.where.onboardingStatus).toBe('EMAIL_VERIFIED');
    expect(args.where.slug).toEqual({ startsWith: 'pending-' });
    expect(args.where.deletedAt).toBeNull();
    // cutoff = now - 7d
    const cutoff = (args.where.createdAt as { lt: Date }).lt;
    expect(cutoff.toISOString()).toBe('2026-06-03T00:00:00.000Z');
    expect(args.data.deletedAt).toBeInstanceOf(Date);
    expect(out.totals?.deletedOrphanTenants).toBe(3);
  });

  it('returns 0 when no matching rows', async () => {
    const { ctx, updateMany } = buildCtx(0);
    const step = new CleanupOrphanTenantsStep(7);
    const out = await step.run(ctx);
    expect(updateMany).toHaveBeenCalledOnce();
    expect(out.totals?.deletedOrphanTenants).toBe(0);
  });

  it('exposes cutoff and ttl in result for audit', async () => {
    const { ctx } = buildCtx(2);
    const step = new CleanupOrphanTenantsStep(30);
    const out = await step.run(ctx);
    const result = out.result as { deleted: number; ttlDays: number; cutoff: string };
    expect(result.deleted).toBe(2);
    expect(result.ttlDays).toBe(30);
    expect(typeof result.cutoff).toBe('string');
  });
});
