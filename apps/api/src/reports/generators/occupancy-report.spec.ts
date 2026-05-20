import { describe, expect, it, vi } from 'vitest';
import { generateOccupancyReport } from './occupancy-report';

function buildCtx(opts: {
  rooms: number;
  /** Map de fecha YYYY-MM-DD → occupied count para esa fecha. */
  occupiedByDate: Record<string, number>;
}) {
  const tx = {
    room: { count: vi.fn().mockResolvedValue(opts.rooms) },
    reservation: {
      count: vi.fn().mockImplementation((args: { where: { departureDate: { gt: Date } } }) => {
        const date = args.where.departureDate.gt.toISOString().slice(0, 10);
        return Promise.resolve(opts.occupiedByDate[date] ?? 0);
      }),
    },
  };
  return { tx: tx as never, tenantId: 't-1' };
}

describe('generateOccupancyReport', () => {
  it('returns a row per day with occupancy ratio', async () => {
    const ctx = buildCtx({
      rooms: 10,
      occupiedByDate: {
        '2026-07-15': 5,
        '2026-07-16': 8,
        '2026-07-17': 10,
      },
    });
    const out = await generateOccupancyReport(ctx, {
      propertyId: 'p-1',
      range: { from: '2026-07-15', to: '2026-07-17' },
    });
    expect(out.rows).toHaveLength(3);
    expect(out.rows[0]).toEqual({
      businessDate: '2026-07-15',
      totalRooms: 10,
      occupied: 5,
      occupancyPct: 0.5,
    });
    expect(out.rows[2]!.occupancyPct).toBe(1);
    expect(out.averageOccupancyPct).toBe(0.7667);
  });

  it('returns 0 occupancy when no rooms exist', async () => {
    const ctx = buildCtx({ rooms: 0, occupiedByDate: {} });
    const out = await generateOccupancyReport(ctx, {
      propertyId: 'p-1',
      range: { from: '2026-07-15', to: '2026-07-15' },
    });
    expect(out.rows[0]!.totalRooms).toBe(0);
    expect(out.rows[0]!.occupancyPct).toBe(0);
    expect(out.averageOccupancyPct).toBe(0);
  });

  it('empty range produces empty rows + average 0', async () => {
    const ctx = buildCtx({ rooms: 5, occupiedByDate: {} });
    const out = await generateOccupancyReport(ctx, {
      propertyId: 'p-1',
      range: { from: '2026-07-20', to: '2026-07-10' },
    });
    expect(out.rows).toEqual([]);
    expect(out.averageOccupancyPct).toBe(0);
  });

  it('treats missing dates as 0 occupied', async () => {
    const ctx = buildCtx({
      rooms: 4,
      occupiedByDate: { '2026-07-15': 2 },
    });
    const out = await generateOccupancyReport(ctx, {
      propertyId: 'p-1',
      range: { from: '2026-07-15', to: '2026-07-17' },
    });
    expect(out.rows.map((r) => r.occupied)).toEqual([2, 0, 0]);
    expect(out.averageOccupancyPct).toBe(0.1667);
  });
});
