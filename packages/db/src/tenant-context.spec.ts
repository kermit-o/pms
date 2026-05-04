import { describe, expect, it, vi } from 'vitest';
import { withTenant } from './tenant-context';
import type { PrismaClient } from '@prisma/client';

describe('withTenant', () => {
  it('throws if tenantId is missing', async () => {
    const prisma = {
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    await expect(
      withTenant(prisma, { tenantId: '' }, async () => 'never'),
    ).rejects.toThrow(/tenantId/);
  });

  it('opens a transaction and sets app.tenant_id via set_config', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(undefined) };
    const prisma = {
      $transaction: vi.fn(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx)),
    } as unknown as PrismaClient;

    const result = await withTenant(
      prisma,
      { tenantId: 'tenant-a' },
      async () => 'value',
    );

    expect(result).toBe('value');
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.$executeRaw).toHaveBeenCalledOnce();

    // The $executeRaw should have been called with template literal segments
    // including 'set_config' and 'app.tenant_id'.
    const [strings, value] = tx.$executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, string];
    expect(strings.join('?')).toContain("set_config('app.tenant_id'");
    expect(value).toBe('tenant-a');
  });

  it('also sets actor_id and correlation_id when provided', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(undefined) };
    const prisma = {
      $transaction: vi.fn(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx)),
    } as unknown as PrismaClient;

    await withTenant(
      prisma,
      { tenantId: 't', actorId: 'a', correlationId: 'c' },
      async () => undefined,
    );

    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
  });
});
