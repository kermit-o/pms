import { Prisma } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { ReportContext } from '../types';
import { generateManagerReport } from './manager-report';

interface Counts {
  inHouse?: number;
  arrivals?: number;
  departures?: number;
  cancellations?: number;
  totalRooms?: number;
  chargesSum?: string;
  chargesCount?: number;
  roomChargesSum?: string;
}

function buildCtx(c: Counts = {}): { ctx: ReportContext } {
  const reservationCount = vi.fn().mockImplementation(({ where }) => {
    if (where?.cancelledAt) {
      return Promise.resolve(c.cancellations ?? 0);
    }
    if (where?.status === 'CHECKED_IN') {
      return Promise.resolve(c.inHouse ?? 0);
    }
    if (where?.arrivalDate && !where?.departureDate) {
      return Promise.resolve(c.arrivals ?? 0);
    }
    if (where?.departureDate && !where?.arrivalDate) {
      return Promise.resolve(c.departures ?? 0);
    }
    return Promise.resolve(0);
  });
  const roomCount = vi.fn().mockResolvedValue(c.totalRooms ?? 0);
  const aggregate = vi.fn().mockImplementation(({ where }) => {
    if (where?.idempotencyKey?.startsWith) {
      return Promise.resolve({
        _sum: {
          amount: c.roomChargesSum ? new Prisma.Decimal(c.roomChargesSum) : null,
        },
      });
    }
    return Promise.resolve({
      _sum: {
        amount: c.chargesSum ? new Prisma.Decimal(c.chargesSum) : null,
      },
      _count: { _all: c.chargesCount ?? 0 },
    });
  });

  const tx = {
    reservation: { count: reservationCount },
    room: { count: roomCount },
    folioEntry: { aggregate },
  } as unknown as Prisma.TransactionClient;

  return { ctx: { tx, tenantId: 'tenant' } };
}

describe('generateManagerReport', () => {
  it('returns ADR + RevPAR + occupancy from in-house counts and room charges', async () => {
    const { ctx } = buildCtx({
      inHouse: 5,
      arrivals: 3,
      departures: 2,
      totalRooms: 10,
      cancellations: 1,
      chargesSum: '700.00',
      chargesCount: 12,
      roomChargesSum: '500.00',
    });
    const out = await generateManagerReport(ctx, {
      propertyId: 'p1',
      businessDate: '2026-06-10',
    });
    expect(out.totalRooms).toBe(10);
    expect(out.inHouse).toBe(5);
    expect(out.arrivals).toBe(3);
    expect(out.departures).toBe(2);
    expect(out.cancellationsToday).toBe(1);
    expect(out.occupancyPct).toBe(0.5);
    expect(out.adr).toBe('100');
    expect(out.revpar).toBe('50');
    expect(out.charges.totalAmount).toBe('700');
    expect(out.charges.count).toBe(12);
  });

  it('handles 0 totalRooms and 0 inHouse without dividing by zero', async () => {
    const { ctx } = buildCtx({});
    const out = await generateManagerReport(ctx, {
      propertyId: 'p1',
      businessDate: '2026-06-10',
    });
    expect(out.occupancyPct).toBe(0);
    expect(out.adr).toBe('0');
    expect(out.revpar).toBe('0');
  });
});
