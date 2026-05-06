import { describe, expect, it, vi } from 'vitest';
import type { StepContext } from '../step';
import { MarkNoShowsStep } from './mark-no-shows';

function buildCtx(candidates: { id: string; code: string }[]) {
  const findMany = vi.fn().mockResolvedValue(candidates);
  const updateMany = vi.fn().mockResolvedValue({ count: candidates.length });
  const tx = {
    reservation: { findMany, updateMany },
  } as unknown as StepContext['tx'];
  const ctx: StepContext = {
    tx,
    user: {
      sub: 'user',
      tenantId: 'tenant',
      email: 'a@b',
      roles: ['night_auditor'],
    },
    correlationId: 'c',
    runId: 'run',
    propertyId: 'prop',
    businessDate: '2026-06-10',
    businessDateAsDate: new Date('2026-06-10'),
  };
  return { ctx, findMany, updateMany };
}

describe('MarkNoShowsStep', () => {
  it('marks PENDING/CONFIRMED reservations with arrival<=today as NO_SHOW', async () => {
    const { ctx, updateMany } = buildCtx([
      { id: 'r1', code: 'BCN-AAA' },
      { id: 'r2', code: 'BCN-BBB' },
    ]);
    const out = await new MarkNoShowsStep().run(ctx);
    expect(updateMany).toHaveBeenCalledOnce();
    const data = updateMany.mock.calls[0]![0].data;
    expect(data.status).toBe('NO_SHOW');
    expect(data.cancellationReason).toBe('no-show via night audit');
    expect(out.totals?.noShowsMarked).toBe(2);
  });

  it('is a no-op when there are no candidates', async () => {
    const { ctx, updateMany } = buildCtx([]);
    const out = await new MarkNoShowsStep().run(ctx);
    expect(updateMany).not.toHaveBeenCalled();
    expect(out.totals?.noShowsMarked).toBe(0);
  });
});
