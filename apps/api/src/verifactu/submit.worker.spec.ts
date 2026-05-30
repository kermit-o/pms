import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { InvoiceStatus, InvoiceSubmissionStatus, Prisma } from '@pms/db';
import type { PrismaService } from '../db';
import type { EventbusService } from '../eventbus';
import type { Env } from '../config/env.schema';
import type { AeatClient } from './aeat';
import type { SignerService } from './signer.service';
import { SubmitWorker } from './submit.worker';

const INV_ID = '00000000-0000-0000-0000-0000000000a1';
const TENANT_ID = '00000000-0000-0000-0000-0000000000b1';

interface InvoiceRow {
  id: string;
  tenantId: string;
  status: InvoiceStatus;
  series: string;
  number: number;
  invoiceDate: Date;
  currency: string;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  customerName: string;
  customerNif: string | null;
  customerAddress: string | null;
}

const baseInvoice: InvoiceRow = {
  id: INV_ID,
  tenantId: TENANT_ID,
  status: InvoiceStatus.ISSUED,
  series: 'A',
  number: 42,
  invoiceDate: new Date('2026-05-30'),
  currency: 'EUR',
  subtotal: new Prisma.Decimal('100.00'),
  taxAmount: new Prisma.Decimal('10.00'),
  totalAmount: new Prisma.Decimal('110.00'),
  customerName: 'Ana Pérez',
  customerNif: '12345678Z',
  customerAddress: 'Calle Mayor 1',
};

function makeWorker(opts: {
  invoice?: InvoiceRow | null;
  existingPendingAttempt?: { id: string; attemptNumber: number } | null;
  lastAttemptNumber?: number | null;
  signer?: Partial<SignerService>;
  aeat: Partial<AeatClient> & { submit: AeatClient['submit'] };
}) {
  let invoiceStatus: InvoiceStatus | null = opts.invoice?.status ?? null;
  const transitions = {
    invoiceUpdate: vi.fn(async ({ data }: { data: { status: InvoiceStatus } }) => {
      invoiceStatus = data.status;
      return { id: INV_ID };
    }),
    submissionUpdate: vi.fn(async () => ({ id: 'sub-1' })),
    submissionCreate: vi.fn(async ({ data }: { data: { attemptNumber: number } }) => ({
      id: 'sub-new',
      attemptNumber: data.attemptNumber,
    })),
  };

  const prisma = {
    invoice: {
      findUnique: vi.fn(async () => (opts.invoice ? { ...opts.invoice, status: invoiceStatus ?? opts.invoice.status } : null)),
      update: transitions.invoiceUpdate,
    },
    invoiceSubmission: {
      findFirst: vi.fn(
        async (args: { where?: { status?: unknown } | undefined; orderBy?: unknown }) => {
          // First call: looking for PENDING/IN_PROGRESS attempt.
          if (
            args.where &&
            typeof args.where.status === 'object' &&
            args.where.status !== null &&
            'in' in (args.where.status as object)
          ) {
            return opts.existingPendingAttempt ?? null;
          }
          // Second call: last attempt number.
          return opts.lastAttemptNumber !== null && opts.lastAttemptNumber !== undefined
            ? { attemptNumber: opts.lastAttemptNumber }
            : null;
        },
      ),
      update: transitions.submissionUpdate,
      create: transitions.submissionCreate,
    },
    $transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
  } as unknown as PrismaService;

  const bus = { publish: vi.fn(async () => ({ id: 'e1', sequence: 1, type: 'x' })) };
  const signer = (opts.signer ?? {
    sign: vi.fn(async () => ({
      xml: '<Signed/>',
      digestValue: 'd',
      signatureValue: 's',
      signingCertificate: {} as never,
    })),
  }) as SignerService;
  const aeat = { mode: 'stub' as const, ...opts.aeat } as AeatClient;

  const config = {
    get: (key: keyof Env) => (key === 'NODE_ENV' ? 'test' : undefined),
  } as unknown as ConfigService<Env, true>;

  return {
    worker: new SubmitWorker(prisma, bus as unknown as EventbusService, signer, aeat, config),
    prisma,
    bus,
    signer,
    transitions,
    getStatus: () => invoiceStatus,
  };
}

describe('SubmitWorker.handle', () => {
  it('returns term when the invoice does not exist', async () => {
    const { worker } = makeWorker({ invoice: null, aeat: { submit: vi.fn() } });
    const r = await worker.handle({ invoiceId: INV_ID, invoiceNumber: 'A-42' }, 1);
    expect(r).toBe('term');
  });

  it('returns ack idempotently when the invoice is already ACCEPTED', async () => {
    const { worker, transitions } = makeWorker({
      invoice: { ...baseInvoice, status: InvoiceStatus.ACCEPTED },
      aeat: { submit: vi.fn() },
    });
    const r = await worker.handle({ invoiceId: INV_ID, invoiceNumber: 'A-42' }, 1);
    expect(r).toBe('ack');
    expect(transitions.submissionUpdate).not.toHaveBeenCalled();
  });

  it('marks ACCEPTED + publishes submitted on AEAT ACCEPTED', async () => {
    const submit = vi.fn().mockResolvedValue({
      status: 'ACCEPTED' as const,
      csv: 'CSV-XYZ',
      responseCode: 200,
      responsePayload: '<ok/>',
    });
    const { worker, transitions, bus, getStatus } = makeWorker({
      invoice: baseInvoice,
      existingPendingAttempt: { id: 'sub-1', attemptNumber: 1 },
      aeat: { submit },
    });
    const r = await worker.handle({ invoiceId: INV_ID, invoiceNumber: 'A-42' }, 1);
    expect(r).toBe('ack');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(getStatus()).toBe(InvoiceStatus.ACCEPTED);
    expect(bus.publish).toHaveBeenCalledWith(
      'verifactu.invoice.submitted',
      { tenantId: TENANT_ID },
      expect.objectContaining({ invoiceId: INV_ID, csv: 'CSV-XYZ', attemptNumber: 1 }),
    );
    // submission marked ACCEPTED
    const updateCalls = transitions.submissionUpdate.mock.calls as unknown as Array<
      [{ data: { status: InvoiceSubmissionStatus } }]
    >;
    const accepted = updateCalls.some(
      (c) => c[0].data.status === InvoiceSubmissionStatus.ACCEPTED,
    );
    expect(accepted).toBe(true);
  });

  it('marks REJECTED + publishes rejected (term) on AEAT REJECTED', async () => {
    const submit = vi.fn().mockResolvedValue({
      status: 'REJECTED' as const,
      responseCode: 422,
      responsePayload: '<err/>',
      errorMessage: 'Invalid NIF format',
    });
    const { worker, bus, getStatus } = makeWorker({
      invoice: baseInvoice,
      existingPendingAttempt: { id: 'sub-1', attemptNumber: 1 },
      aeat: { submit },
    });
    const r = await worker.handle({ invoiceId: INV_ID, invoiceNumber: 'A-42' }, 1);
    expect(r).toBe('term');
    expect(getStatus()).toBe(InvoiceStatus.REJECTED);
    expect(bus.publish).toHaveBeenCalledWith(
      'verifactu.invoice.rejected',
      { tenantId: TENANT_ID },
      expect.objectContaining({ errorMessage: 'Invalid NIF format', isDeadLetter: true }),
    );
  });

  it('returns nak when sign throws and delivery attempts remain', async () => {
    const sign = vi.fn().mockRejectedValue(new Error('No certificate for tenant'));
    const { worker, bus } = makeWorker({
      invoice: baseInvoice,
      existingPendingAttempt: { id: 'sub-1', attemptNumber: 1 },
      aeat: { submit: vi.fn() },
      signer: { sign },
    });
    const r = await worker.handle({ invoiceId: INV_ID, invoiceNumber: 'A-42' }, 2); // <5
    expect(r).toBe('nak');
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('dead-letters + publishes rejected when sign throws on the last attempt', async () => {
    const sign = vi.fn().mockRejectedValue(new Error('No certificate for tenant'));
    const { worker, bus, getStatus } = makeWorker({
      invoice: baseInvoice,
      existingPendingAttempt: { id: 'sub-1', attemptNumber: 1 },
      aeat: { submit: vi.fn() },
      signer: { sign },
    });
    const r = await worker.handle({ invoiceId: INV_ID, invoiceNumber: 'A-42' }, 5); // maxDeliver
    expect(r).toBe('term');
    expect(getStatus()).toBe(InvoiceStatus.REJECTED);
    expect(bus.publish).toHaveBeenCalledWith(
      'verifactu.invoice.rejected',
      { tenantId: TENANT_ID },
      expect.objectContaining({ isDeadLetter: true }),
    );
  });

  it('returns nak when the AEAT client throws transitorily', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const { worker } = makeWorker({
      invoice: baseInvoice,
      existingPendingAttempt: { id: 'sub-1', attemptNumber: 1 },
      aeat: { submit },
    });
    const r = await worker.handle({ invoiceId: INV_ID, invoiceNumber: 'A-42' }, 1);
    expect(r).toBe('nak');
  });
});
