import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { jwtVerify } from 'jose';
import type { AuthUser } from '../auth';
import { PAIRING_TOKEN_ISSUER } from '../auth/jwt-validator.service';
import { DevicePairingsService } from './device-pairings.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SUPERVISOR_ID = '22222222-2222-2222-2222-222222222222';
const TARGET_USER_ID = '33333333-3333-3333-3333-333333333333';

const supervisor: AuthUser = {
  sub: SUPERVISOR_ID,
  tenantId: TENANT_ID,
  email: 'sup@hotel.test',
  roles: ['housekeeping_supervisor'],
};

const SECRET = new TextEncoder().encode('this-is-a-32-char-test-secret-xx!!');

interface BuildOpts {
  targetUser?: { id: string; email: string } | null;
  existing?: {
    id: string;
    code: string;
    tenantId: string;
    targetUserId: string;
    issuedByUserId: string;
    expiresAt: Date;
    redeemedAt: Date | null;
    redeemedTokenJti: string | null;
    createdAt: Date;
  } | null;
}

function buildService(opts: BuildOpts = {}) {
  const target =
    opts.targetUser === undefined
      ? { id: TARGET_USER_ID, email: 'cam@hotel.test' }
      : opts.targetUser;
  let stored = opts.existing ?? null;

  const userFindFirst = vi.fn().mockResolvedValue(target);
  const pairingFindFirst = vi.fn().mockImplementation(() => Promise.resolve(stored));
  const pairingCreate = vi.fn().mockImplementation(({ data }) => {
    stored = {
      id: 'pair-1',
      code: data.code,
      tenantId: data.tenantId,
      targetUserId: data.targetUserId,
      issuedByUserId: data.issuedByUserId,
      expiresAt: data.expiresAt,
      redeemedAt: null,
      redeemedTokenJti: null,
      createdAt: new Date(),
    };
    return Promise.resolve(stored);
  });
  const pairingUpdate = vi.fn().mockImplementation(({ data }) => {
    if (stored) stored = { ...stored, ...data };
    return Promise.resolve(stored);
  });

  const tx = {
    user: { findFirst: userFindFirst },
    devicePairing: {
      findFirst: pairingFindFirst,
      create: pairingCreate,
      update: pairingUpdate,
    },
  };
  const prisma = { withTenant: vi.fn(async (_ctx, fn: (t: typeof tx) => unknown) => fn(tx)) };
  const jwt = { getPairingSecret: () => SECRET };
  const config = {
    get: (key: string) => {
      if (key === 'PAIRING_CODE_TTL_SECONDS') return 120;
      if (key === 'PAIRING_TOKEN_TTL_HOURS') return 12;
      return undefined;
    },
  };

  const metrics = {
    pairingsMinted: { add: vi.fn() },
    pairingsRedeemed: { add: vi.fn() },
  };

  const service = new DevicePairingsService(
    prisma as never,
    jwt as never,
    config as never,
    metrics as never,
  );
  return { service, tx, metrics };
}

describe('DevicePairingsService.mint', () => {
  it('creates a 12-char code with a future expiry', async () => {
    const { service } = buildService();
    const out = await service.mint(supervisor, 'corr', { targetUserId: TARGET_USER_ID });
    expect(out.code).toMatch(/^[A-Z2-9]{12}$/);
    expect(new Date(out.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(out.qrPayload).toContain(`tenantId=${TENANT_ID}`);
    expect(out.qrPayload).toContain(`code=${out.code}`);
  });

  it('rejects when target user is not in the tenant', async () => {
    const { service } = buildService({ targetUser: null });
    await expect(
      service.mint(supervisor, 'corr', { targetUserId: TARGET_USER_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DevicePairingsService.redeem', () => {
  function existingPairing(overrides: Partial<BuildOpts['existing']> = {}) {
    return {
      id: 'pair-1',
      code: 'ABCDEFGHJKLM',
      tenantId: TENANT_ID,
      targetUserId: TARGET_USER_ID,
      issuedByUserId: SUPERVISOR_ID,
      expiresAt: new Date(Date.now() + 60_000),
      redeemedAt: null,
      redeemedTokenJti: null,
      createdAt: new Date(),
      ...overrides,
    };
  }

  it('returns a HMAC JWT with iss=aubergine-pairing, marks the row redeemed, records success', async () => {
    const { service, tx, metrics } = buildService({ existing: existingPairing() });
    const out = await service.redeem('corr', {
      tenantId: TENANT_ID,
      code: 'ABCDEFGHJKLM',
    });
    expect(out.token).toBeTypeOf('string');
    const { payload } = await jwtVerify(out.token, SECRET, { issuer: PAIRING_TOKEN_ISSUER });
    expect(payload.sub).toBe(TARGET_USER_ID);
    expect(payload.tenant_id).toBe(TENANT_ID);
    expect(payload.roles).toEqual(['housekeeper']);
    expect(tx.devicePairing.update).toHaveBeenCalledOnce();
    expect(metrics.pairingsRedeemed.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ outcome: 'success' }),
    );
  });

  it('rejects an already-redeemed code', async () => {
    const { service } = buildService({
      existing: existingPairing({ redeemedAt: new Date() }),
    });
    await expect(
      service.redeem('corr', { tenantId: TENANT_ID, code: 'ABCDEFGHJKLM' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an expired code', async () => {
    const { service } = buildService({
      existing: existingPairing({ expiresAt: new Date(Date.now() - 1000) }),
    });
    await expect(
      service.redeem('corr', { tenantId: TENANT_ID, code: 'ABCDEFGHJKLM' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unknown code', async () => {
    const { service } = buildService({ existing: null });
    await expect(
      service.redeem('corr', { tenantId: TENANT_ID, code: 'ABCDEFGHJKLM' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
