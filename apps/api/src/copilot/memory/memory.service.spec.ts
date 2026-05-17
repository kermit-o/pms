import { describe, expect, it, vi } from 'vitest';
import { MemoryService } from './memory.service';
import type { AuthUser } from '../../auth';

const user: AuthUser = {
  sub: '22222222-2222-2222-2222-222222222222',
  tenantId: '11111111-1111-1111-1111-111111111111',
  email: 'desk@hotel.test',
  roles: ['front_desk'],
};
const GUEST_ID = '33333333-3333-3333-3333-333333333333';

function buildService(opts: {
  countResult?: number;
  rankedRows?: Array<{ source_kind: string; source_ref: string | null; chunk_text: string; score: number }>;
  guest?: unknown;
}) {
  const tx = {
    guestMemoryChunk: {
      count: vi.fn().mockResolvedValue(opts.countResult ?? 0),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    guest: {
      findFirst: vi.fn().mockResolvedValue(opts.guest ?? null),
    },
    $queryRaw: vi.fn().mockResolvedValue(opts.rankedRows ?? []),
  };
  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  return { service: new MemoryService(prisma as never), tx };
}

describe('MemoryService.recall', () => {
  it('lazy-ingests when there are no chunks yet, then queries', async () => {
    const { service, tx } = buildService({
      countResult: 0,
      guest: {
        id: GUEST_ID,
        firstName: 'María',
        lastName: 'Pérez',
        nationality: 'ES',
        documentType: null,
        documentNumber: null,
        membershipLevel: 'Gold',
        notes: 'Alérgica al marisco.',
        attributes: null,
        reservations: [],
      },
      rankedRows: [
        { source_kind: 'CARDEX', source_ref: 'self', chunk_text: 'Alergia al marisco', score: 0.5 },
      ],
    });
    const out = await service.recall(user, 'cid', { guestId: GUEST_ID, query: 'alergia', limit: 5 });
    expect(out.ingested).toBe(true);
    expect(tx.guestMemoryChunk.deleteMany).toHaveBeenCalledOnce();
    expect(tx.guestMemoryChunk.createMany).toHaveBeenCalledOnce();
    expect(out.chunks).toHaveLength(1);
    expect(out.chunks[0]!.text).toMatch(/marisco/);
  });

  it('skips ingestion if chunks already exist', async () => {
    const { service, tx } = buildService({
      countResult: 5,
      rankedRows: [
        { source_kind: 'STAY_NOTE', source_ref: 'r1', chunk_text: 'Pidió cuna', score: 0.3 },
      ],
    });
    const out = await service.recall(user, 'cid', { guestId: GUEST_ID, query: 'cuna', limit: 5 });
    expect(out.ingested).toBe(false);
    expect(tx.guest.findFirst).not.toHaveBeenCalled();
    expect(tx.guestMemoryChunk.createMany).not.toHaveBeenCalled();
    expect(out.chunks[0]!.sourceKind).toBe('STAY_NOTE');
  });

  it('returns empty chunks if nothing matches the query', async () => {
    const { service } = buildService({ countResult: 5, rankedRows: [] });
    const out = await service.recall(user, 'cid', { guestId: GUEST_ID, query: 'xyz', limit: 5 });
    expect(out.chunks).toEqual([]);
  });
});

describe('MemoryService.ingestForGuest', () => {
  it('writes cardex chunk + 1 stay chunk + folio entry chunk', async () => {
    const { service, tx } = buildService({
      countResult: 0,
      guest: {
        id: GUEST_ID,
        firstName: 'Juan',
        lastName: 'García',
        nationality: 'ES',
        documentType: 'PASSPORT',
        documentNumber: 'X123',
        membershipLevel: null,
        notes: null,
        attributes: { preferences: 'cama dura' },
        reservations: [
          {
            reservationId: 'r1',
            isPrimary: true,
            reservation: {
              id: 'r1',
              code: 'HTL-1',
              status: 'CHECKED_OUT',
              arrivalDate: new Date('2026-04-10'),
              departureDate: new Date('2026-04-12'),
              specialRequests: 'cama dura',
              notes: null,
              agencyName: null,
              companyName: null,
              totalAmount: { toString: () => '200.00' },
              currency: 'EUR',
              roomType: { code: 'DBL', name: 'Doble' },
              folio: {
                entries: [
                  {
                    description: 'Minibar agua',
                    amount: { toString: () => '5.00' },
                    type: 'CHARGE',
                    postedAt: new Date('2026-04-11'),
                  },
                ],
              },
            },
          },
        ],
      },
    });
    const out = await service.ingestForGuest(user, 'cid', GUEST_ID);
    expect(out.written).toBeGreaterThanOrEqual(3); // cardex + stay + folio + special_request
    expect(tx.guestMemoryChunk.deleteMany).toHaveBeenCalledOnce();
    expect(tx.guestMemoryChunk.createMany).toHaveBeenCalledOnce();
    const payload = tx.guestMemoryChunk.createMany.mock.calls[0]![0].data as Array<{
      sourceKind: string;
      chunkText: string;
    }>;
    const kinds = payload.map((p) => p.sourceKind);
    expect(kinds).toContain('CARDEX');
    expect(kinds).toContain('STAY_NOTE');
    expect(kinds).toContain('FOLIO_NOTE');
    expect(kinds).toContain('SPECIAL_REQUEST');
  });

  it('writes nothing when the guest has no notes / reservations', async () => {
    const { service, tx } = buildService({
      countResult: 0,
      guest: {
        id: GUEST_ID,
        firstName: 'Ana',
        lastName: 'Smith',
        nationality: null,
        documentType: null,
        documentNumber: null,
        membershipLevel: null,
        notes: null,
        attributes: null,
        reservations: [],
      },
    });
    const out = await service.ingestForGuest(user, 'cid', GUEST_ID);
    expect(out.written).toBe(1); // sólo el cardex con el nombre
    const payload = tx.guestMemoryChunk.createMany.mock.calls[0]![0].data as Array<{
      sourceKind: string;
    }>;
    expect(payload.map((p) => p.sourceKind)).toEqual(['CARDEX']);
  });
});
