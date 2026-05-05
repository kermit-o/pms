import { ConflictException, NotFoundException } from '@nestjs/common';
import { BusinessDayStatus } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth';
import { BusinessDayService } from './business-day.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';

const user: AuthUser = {
  sub: USER_ID,
  tenantId: TENANT_ID,
  email: 'auditor@hotel.test',
  roles: ['night_auditor'],
};

function buildService(opts: {
  existing?:
    | {
        propertyId: string;
        businessDate: Date;
        status: BusinessDayStatus;
        closedAt: Date | null;
        closedByUserId: string | null;
        reopenedAt: Date | null;
        reopenedReason: string | null;
      }
    | null;
}) {
  const findFirst = vi.fn().mockResolvedValue(opts.existing ?? null);
  const create = vi.fn().mockResolvedValue({});
  const update = vi.fn().mockResolvedValue({});

  const tx = {
    businessDayState: { findFirst, create, update },
  };
  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const events = { publish: vi.fn().mockResolvedValue({ id: 'evt' }) };
  const service = new BusinessDayService(prisma as never, events as never);
  return { service, tx, events };
}

describe('BusinessDayService.close', () => {
  it('creates a CLOSED row and emits business_day.closed', async () => {
    const { service, tx, events } = buildService({ existing: null });
    await service.close(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
    });
    expect(tx.businessDayState.create).toHaveBeenCalledOnce();
    const data = tx.businessDayState.create.mock.calls[0]![0].data;
    expect(data.status).toBe(BusinessDayStatus.CLOSED);
    expect(data.closedByUserId).toBe(USER_ID);
    expect(events.publish.mock.calls[0]![0]).toBe('business_day.closed');
  });

  it('updates an existing OPEN row to CLOSED', async () => {
    const { service, tx } = buildService({
      existing: {
        propertyId: PROPERTY_ID,
        businessDate: new Date('2026-06-10'),
        status: BusinessDayStatus.OPEN,
        closedAt: null,
        closedByUserId: null,
        reopenedAt: null,
        reopenedReason: null,
      },
    });
    await service.close(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
    });
    expect(tx.businessDayState.update).toHaveBeenCalledOnce();
  });

  it('rejects double-close', async () => {
    const { service } = buildService({
      existing: {
        propertyId: PROPERTY_ID,
        businessDate: new Date('2026-06-10'),
        status: BusinessDayStatus.CLOSED,
        closedAt: new Date(),
        closedByUserId: USER_ID,
        reopenedAt: null,
        reopenedReason: null,
      },
    });
    await expect(
      service.close(user, 'corr', {
        propertyId: PROPERTY_ID,
        businessDate: '2026-06-10',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('BusinessDayService.reopen', () => {
  it('reopens a CLOSED day and emits business_day.reopened', async () => {
    const { service, events, tx } = buildService({
      existing: {
        propertyId: PROPERTY_ID,
        businessDate: new Date('2026-06-10'),
        status: BusinessDayStatus.CLOSED,
        closedAt: new Date(),
        closedByUserId: USER_ID,
        reopenedAt: null,
        reopenedReason: null,
      },
    });
    await service.reopen(user, 'corr', {
      propertyId: PROPERTY_ID,
      businessDate: '2026-06-10',
      reason: 'late charge correction',
    });
    expect(tx.businessDayState.update).toHaveBeenCalledOnce();
    const data = tx.businessDayState.update.mock.calls[0]![0].data;
    expect(data.status).toBe(BusinessDayStatus.OPEN);
    expect(data.reopenedReason).toBe('late charge correction');
    expect(events.publish.mock.calls[0]![0]).toBe('business_day.reopened');
  });

  it('rejects reopen on missing record', async () => {
    const { service } = buildService({ existing: null });
    await expect(
      service.reopen(user, 'corr', {
        propertyId: PROPERTY_ID,
        businessDate: '2026-06-10',
        reason: 'oops',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects reopen on already-OPEN day', async () => {
    const { service } = buildService({
      existing: {
        propertyId: PROPERTY_ID,
        businessDate: new Date('2026-06-10'),
        status: BusinessDayStatus.OPEN,
        closedAt: null,
        closedByUserId: null,
        reopenedAt: null,
        reopenedReason: null,
      },
    });
    await expect(
      service.reopen(user, 'corr', {
        propertyId: PROPERTY_ID,
        businessDate: '2026-06-10',
        reason: 'x',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('BusinessDayService.getState', () => {
  it('returns OPEN default when no row exists', async () => {
    const { service } = buildService({ existing: null });
    const out = await service.getState(
      user,
      'corr',
      PROPERTY_ID,
      '2026-06-10',
    );
    expect(out.status).toBe(BusinessDayStatus.OPEN);
    expect(out.closedAt).toBeNull();
  });
});
