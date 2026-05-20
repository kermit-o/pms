import { describe, expect, it, vi } from 'vitest';
import { EmailSuppressionsService } from './email-suppressions.service';

function buildService(opts: { existing?: { reason: string } | null } = {}) {
  const prisma = {
    emailSuppression: {
      findUnique: vi.fn().mockResolvedValue(opts.existing ?? null),
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const service = new EmailSuppressionsService(prisma as never);
  return { service, prisma };
}

describe('EmailSuppressionsService.isSuppressed', () => {
  it('returns suppressed=false when no row', async () => {
    const { service } = buildService();
    const out = await service.isSuppressed('a@b.test');
    expect(out.suppressed).toBe(false);
  });

  it('returns suppressed=true with reason when row exists', async () => {
    const { service } = buildService({ existing: { reason: 'HARD_BOUNCE' } });
    const out = await service.isSuppressed('a@b.test');
    expect(out.suppressed).toBe(true);
    expect(out.reason).toBe('HARD_BOUNCE');
  });

  it('normalises email to lowercase', async () => {
    const { service, prisma } = buildService();
    await service.isSuppressed('   Aa@B.test  ');
    expect(prisma.emailSuppression.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'aa@b.test' } }),
    );
  });
});

describe('EmailSuppressionsService.upsert', () => {
  it('upserts with normalised email and truncated detail', async () => {
    const { service, prisma } = buildService();
    const longDetail = 'x'.repeat(900);
    await service.upsert({
      email: '  USER@EX.com',
      reason: 'HARD_BOUNCE' as never,
      detail: longDetail,
      source: 'postmark',
    });
    const args = prisma.emailSuppression.upsert.mock.calls[0]![0]!;
    expect(args.where).toEqual({ email: 'user@ex.com' });
    expect(args.create.detail).toHaveLength(500);
    expect(args.create.source).toBe('postmark');
  });

  it('skips empty emails', async () => {
    const { service, prisma } = buildService();
    await service.upsert({ email: '  ', reason: 'MANUAL' as never, source: 'manual' });
    expect(prisma.emailSuppression.upsert).not.toHaveBeenCalled();
  });
});

describe('EmailSuppressionsService.remove', () => {
  it('deletes and returns true when count > 0', async () => {
    const { service } = buildService();
    expect(await service.remove('a@b.test')).toBe(true);
  });
});
