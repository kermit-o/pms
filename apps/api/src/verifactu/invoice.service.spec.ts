import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FolioStatus, InvoiceStatus, Prisma } from '@pms/db';
import type { AuthUser } from '../auth';
import type { PrismaService } from '../db';
import type { EventbusService } from '../eventbus';
import { InvoiceService } from './invoice.service';

const user: AuthUser = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  email: 'op@hotel.test',
  roles: ['tenant_admin'],
} as unknown as AuthUser;

interface FakeFolio {
  id: string;
  status: FolioStatus;
  currency: string;
  reservation: { propertyId: string };
  entries: Array<{ type: string; description: string; amount: Prisma.Decimal | string }>;
}

interface FakeInvoice {
  id: string;
  series: string;
  number: number;
  totalAmount: Prisma.Decimal;
  status: InvoiceStatus;
}

function makeService(opts: {
  folio?: FakeFolio | null;
  existingInvoice?: FakeInvoice | null;
  lastInvoiceNumber?: number;
  /** Default tenant: NIF + razón social poblados (Verifactu-ready). */
  tenant?: { nif: string | null; razonSocial: string | null } | null;
  /** Última huella del emisor (null si esta es la primera factura). */
  lastChainedHuella?: string | null;
}): {
  service: InvoiceService;
  events: { publish: ReturnType<typeof vi.fn> };
  createdInvoices: unknown[];
  createdSubmissions: unknown[];
} {
  const createdInvoices: unknown[] = [];
  const createdSubmissions: unknown[] = [];

  const tenantRow =
    opts.tenant === undefined
      ? { nif: 'B12345678', razonSocial: 'Aubergine Test S.L.' }
      : opts.tenant;

  const tx = {
    $executeRaw: vi.fn(async () => 1),
    folio: { findFirst: vi.fn(async () => opts.folio ?? null) },
    tenant: { findUnique: vi.fn(async () => tenantRow) },
    invoice: {
      findFirst: vi.fn(
        async (args: {
          where?: { folioId?: unknown; series?: unknown; huella?: unknown };
          orderBy?: unknown;
        }) => {
          // (c) Chain huella lookup: where.huella = { not: null }.
          if (args.where?.huella !== undefined) {
            return opts.lastChainedHuella !== undefined && opts.lastChainedHuella !== null
              ? { huella: opts.lastChainedHuella }
              : null;
          }
          // (b) Last number in series: where.series + orderBy.
          if (args.where?.series !== undefined) {
            return opts.lastInvoiceNumber !== undefined
              ? { number: opts.lastInvoiceNumber }
              : null;
          }
          // (a) Idempotency lookup: where.folioId.
          return opts.existingInvoice ?? null;
        },
      ),
      create: vi.fn(async ({ data }: { data: { lines: unknown } }) => {
        createdInvoices.push(data);
        return { id: 'inv-new' };
      }),
    },
    invoiceSubmission: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        createdSubmissions.push(data);
        return { id: 'sub-new' };
      }),
    },
  };

  const prisma = {
    withTenant: vi.fn(async <T,>(_ctx: unknown, fn: (tx: unknown) => Promise<T>) => fn(tx)),
  } as unknown as PrismaService;

  const events = { publish: vi.fn(async () => ({ id: 'e1', sequence: 1, type: 'x' })) };
  const service = new InvoiceService(prisma, events as unknown as EventbusService);

  return { service, events, createdInvoices, createdSubmissions };
}

describe('InvoiceService.issue', () => {
  it('rejects an empty customer name', async () => {
    const { service } = makeService({});
    await expect(
      service.issue(user, 'corr-1', { folioId: 'f1', customerName: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invalid series', async () => {
    const { service } = makeService({});
    await expect(
      service.issue(user, 'corr-1', { folioId: 'f1', customerName: 'Ana', series: 'invalid lower' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFound when the folio does not exist', async () => {
    const { service } = makeService({ folio: null });
    await expect(
      service.issue(user, 'corr-1', { folioId: 'missing', customerName: 'Ana' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws Conflict when the folio is still OPEN', async () => {
    const { service } = makeService({
      folio: {
        id: 'f1',
        status: FolioStatus.OPEN,
        currency: 'EUR',
        reservation: { propertyId: 'p1' },
        entries: [],
      },
    });
    await expect(
      service.issue(user, 'corr-1', { folioId: 'f1', customerName: 'Ana' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns the existing invoice on duplicate issue (idempotent)', async () => {
    const { service, events } = makeService({
      folio: {
        id: 'f1',
        status: FolioStatus.SETTLED,
        currency: 'EUR',
        reservation: { propertyId: 'p1' },
        entries: [],
      },
      existingInvoice: {
        id: 'inv-existing',
        series: 'A',
        number: 7,
        totalAmount: new Prisma.Decimal('110.00'),
        status: InvoiceStatus.ISSUED,
      },
    });
    const r = await service.issue(user, 'corr-1', { folioId: 'f1', customerName: 'Ana' });
    expect(r.id).toBe('inv-existing');
    expect(r.invoiceNumber).toBe('A-7');
    expect(r.alreadyExisted).toBe(true);
    // No new event is published for an idempotent return.
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('issues a new invoice, persists submission row and publishes event', async () => {
    const { service, events, createdInvoices, createdSubmissions } = makeService({
      folio: {
        id: 'f1',
        status: FolioStatus.SETTLED,
        currency: 'EUR',
        reservation: { propertyId: 'p1' },
        entries: [
          { type: 'CHARGE', description: 'Room', amount: '100.00' },
          { type: 'TAX', description: 'IVA 10%', amount: '10.00' },
          { type: 'PAYMENT', description: 'Card', amount: '-110.00' },
        ],
      },
      lastInvoiceNumber: 42,
    });

    const r = await service.issue(user, 'corr-1', {
      folioId: 'f1',
      customerName: 'Ana Pérez',
      customerNif: '12345678Z',
    });

    expect(r.alreadyExisted).toBe(false);
    expect(r.invoiceNumber).toBe('A-43');
    expect(r.totalAmount).toBe('110.00');

    expect(createdInvoices).toHaveLength(1);
    const inv = createdInvoices[0] as { lines: unknown[]; subtotal: Prisma.Decimal };
    expect(inv.lines).toHaveLength(2);

    expect(createdSubmissions).toHaveLength(1);
    expect(events.publish).toHaveBeenCalledWith(
      'verifactu.invoice.submit_requested',
      expect.objectContaining({ tenantId: 'tenant-1' }),
      { invoiceId: 'inv-new', invoiceNumber: 'A-43' },
    );
  });
});

describe('InvoiceService.findByFolio', () => {
  it('returns null when no invoice exists for the folio', async () => {
    const { service } = makeService({ existingInvoice: null });
    const r = await service.findByFolio(user, 'corr-1', 'f1');
    expect(r).toBeNull();
  });

  it('returns the active invoice with alreadyExisted=true', async () => {
    const { service } = makeService({
      existingInvoice: {
        id: 'inv-7',
        series: 'A',
        number: 99,
        totalAmount: new Prisma.Decimal('250.00'),
        status: InvoiceStatus.ISSUED,
      },
    });
    const r = await service.findByFolio(user, 'corr-1', 'f1');
    expect(r).not.toBeNull();
    expect(r!.id).toBe('inv-7');
    expect(r!.invoiceNumber).toBe('A-99');
    expect(r!.totalAmount).toBe('250');
    expect(r!.alreadyExisted).toBe(true);
  });
});

describe('InvoiceService.issue · Verifactu wiring', () => {
  const folio: FakeFolio = {
    id: 'f1',
    status: FolioStatus.CLOSED,
    currency: 'EUR',
    reservation: { propertyId: 'p1' },
    entries: [
      { type: 'CHARGE', description: 'Room', amount: new Prisma.Decimal('100.00') },
    ],
  };

  it('rejects when the tenant has no NIF or razón social configured', async () => {
    const { service } = makeService({ folio, tenant: { nif: null, razonSocial: null } });
    await expect(
      service.issue(user, 'corr-1', { folioId: 'f1', customerName: 'Ana' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists tipo=F1 + a non-empty huella for a customer with NIF', async () => {
    const { service, createdInvoices } = makeService({ folio });
    await service.issue(user, 'corr-1', {
      folioId: 'f1',
      customerName: 'Ana Pérez',
      customerNif: '12345678Z',
    });
    const inv = createdInvoices[0] as {
      tipoFactura: string;
      huella: string;
      huellaAnterior: string | null;
    };
    expect(inv.tipoFactura).toBe('F1');
    expect(inv.huella).toMatch(/^[0-9a-f]{64}$/);
    expect(inv.huellaAnterior).toBeNull();
  });

  it('classifies as F2 when there is no NIF and total ≤ 3.000 €', async () => {
    const { service, createdInvoices } = makeService({ folio });
    await service.issue(user, 'corr-1', {
      folioId: 'f1',
      customerName: 'Walk-in cash guest',
    });
    const inv = createdInvoices[0] as { tipoFactura: string };
    expect(inv.tipoFactura).toBe('F2');
  });

  it('chains the new huella against the previous one (huellaAnterior set)', async () => {
    const prev = 'a'.repeat(64);
    const { service, createdInvoices } = makeService({ folio, lastChainedHuella: prev });
    await service.issue(user, 'corr-1', {
      folioId: 'f1',
      customerName: 'Ana Pérez',
      customerNif: '12345678Z',
    });
    const inv = createdInvoices[0] as { huella: string; huellaAnterior: string | null };
    expect(inv.huellaAnterior).toBe(prev);
    // Distinta de la primera (cadena distinta).
    expect(inv.huella).not.toBe(prev);
  });
});

describe('InvoiceService.requeueSubmission', () => {
  function makeRequeueService(opts: {
    invoice?: { id: string; status: InvoiceStatus; series: string; number: number } | null;
    pendingAttempt?: { id: string } | null;
  }) {
    const tx = {
      invoice: {
        findFirst: vi.fn(async () => opts.invoice ?? null),
      },
      invoiceSubmission: {
        findFirst: vi.fn(async () => opts.pendingAttempt ?? null),
      },
    };
    const prisma = {
      withTenant: vi.fn(async <T,>(_ctx: unknown, fn: (tx: unknown) => Promise<T>) => fn(tx)),
    } as unknown as PrismaService;
    const events = { publish: vi.fn(async () => ({ id: 'e1', sequence: 1, type: 'x' })) };
    const service = new InvoiceService(prisma, events as unknown as EventbusService);
    return { service, events };
  }

  it('throws NotFound when the invoice does not exist', async () => {
    const { service } = makeRequeueService({ invoice: null });
    await expect(
      service.requeueSubmission(user, 'corr-1', '00000000-0000-0000-0000-000000000001'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws Conflict when the invoice is already ACCEPTED', async () => {
    const { service } = makeRequeueService({
      invoice: { id: 'i1', status: InvoiceStatus.ACCEPTED, series: 'A', number: 5 },
    });
    await expect(
      service.requeueSubmission(user, 'corr-1', 'i1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws Conflict when a PENDING attempt is already in flight', async () => {
    const { service } = makeRequeueService({
      invoice: { id: 'i1', status: InvoiceStatus.REJECTED, series: 'A', number: 5 },
      pendingAttempt: { id: 'sub-pending' },
    });
    await expect(
      service.requeueSubmission(user, 'corr-1', 'i1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('republishes submit_requested when the invoice is requeue-able', async () => {
    const { service, events } = makeRequeueService({
      invoice: { id: 'i1', status: InvoiceStatus.REJECTED, series: 'A', number: 5 },
      pendingAttempt: null,
    });
    const r = await service.requeueSubmission(user, 'corr-1', 'i1');
    expect(r.invoiceNumber).toBe('A-5');
    expect(events.publish).toHaveBeenCalledWith(
      'verifactu.invoice.submit_requested',
      expect.objectContaining({ tenantId: 'tenant-1' }),
      { invoiceId: 'i1', invoiceNumber: 'A-5' },
    );
  });
});
