import type { Prisma } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { ReportContext } from '../types';
import { generateArrivalsDeparturesReport } from './arrivals-departures-report';

function buildCtx(arrivals: unknown[], departures: unknown[]) {
  const findMany = vi.fn().mockImplementation(({ where }) => {
    if (where?.arrivalDate instanceof Date && where?.departureDate === undefined) {
      return Promise.resolve(arrivals);
    }
    if (where?.departureDate instanceof Date) {
      return Promise.resolve(departures);
    }
    return Promise.resolve([]);
  });
  const tx = {
    reservation: { findMany },
  } as unknown as Prisma.TransactionClient;
  return { ctx: { tx, tenantId: 'tenant' } as ReportContext };
}

describe('generateArrivalsDeparturesReport', () => {
  it('returns separate arrival and departure lists with primary guest', async () => {
    const { ctx } = buildCtx(
      [
        {
          id: 'a1',
          code: 'BCN-A1',
          status: 'CONFIRMED',
          arrivalDate: new Date('2026-06-10'),
          departureDate: new Date('2026-06-12'),
          room: null,
          guests: [{ guest: { firstName: 'Ana', lastName: 'G' } }],
        },
      ],
      [
        {
          id: 'd1',
          code: 'BCN-D1',
          status: 'CHECKED_OUT',
          arrivalDate: new Date('2026-06-08'),
          departureDate: new Date('2026-06-10'),
          room: { number: '102' },
          guests: [{ guest: { firstName: 'Bob', lastName: 'S' } }],
        },
      ],
    );

    const out = await generateArrivalsDeparturesReport(ctx, {
      propertyId: 'p',
      businessDate: '2026-06-10',
    });
    expect(out.arrivals).toHaveLength(1);
    expect(out.departures).toHaveLength(1);
    expect(out.arrivals[0]!.primaryGuest).toBe('G, Ana');
    expect(out.departures[0]!.roomNumber).toBe('102');
  });

  it('returns empty arrays when nothing matches', async () => {
    const { ctx } = buildCtx([], []);
    const out = await generateArrivalsDeparturesReport(ctx, {
      propertyId: 'p',
      businessDate: '2026-06-10',
    });
    expect(out.arrivals).toEqual([]);
    expect(out.departures).toEqual([]);
  });
});
