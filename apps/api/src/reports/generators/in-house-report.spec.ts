import { Prisma } from '@pms/db';
import { describe, expect, it, vi } from 'vitest';
import type { ReportContext } from '../types';
import { generateInHouseReport } from './in-house-report';

function buildCtx(rows: unknown[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const tx = {
    reservation: { findMany },
  } as unknown as Prisma.TransactionClient;
  return { ctx: { tx, tenantId: 'tenant' } as ReportContext, findMany };
}

describe('generateInHouseReport', () => {
  it('returns one row per CHECKED_IN reservation with primary guest + folio balance', async () => {
    const { ctx } = buildCtx([
      {
        id: 'r1',
        code: 'BCN-AAA',
        arrivalDate: new Date('2026-06-09'),
        departureDate: new Date('2026-06-12'),
        adults: 2,
        children: 1,
        currency: 'EUR',
        room: { number: '101' },
        folio: { balance: new Prisma.Decimal('250.00'), currency: 'EUR' },
        guests: [{ guest: { firstName: 'Ana', lastName: 'García' } }],
      },
    ]);
    const out = await generateInHouseReport(ctx, {
      propertyId: 'p',
      businessDate: '2026-06-10',
    });
    expect(out.count).toBe(1);
    expect(out.rows[0]).toMatchObject({
      reservationId: 'r1',
      code: 'BCN-AAA',
      roomNumber: '101',
      primaryGuest: 'García, Ana',
      adults: 2,
      children: 1,
      balance: '250',
      currency: 'EUR',
    });
  });

  it('falls back to nulls when room/folio/primary-guest are absent', async () => {
    const { ctx } = buildCtx([
      {
        id: 'r2',
        code: 'BCN-BBB',
        arrivalDate: new Date('2026-06-10'),
        departureDate: new Date('2026-06-11'),
        adults: 1,
        children: 0,
        currency: 'EUR',
        room: null,
        folio: null,
        guests: [],
      },
    ]);
    const out = await generateInHouseReport(ctx, {
      propertyId: 'p',
      businessDate: '2026-06-10',
    });
    expect(out.rows[0]).toMatchObject({
      roomNumber: null,
      primaryGuest: null,
      balance: '0',
      currency: 'EUR',
    });
  });
});
