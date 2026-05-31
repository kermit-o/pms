/**
 * Test de integración Verifactu: `InvoiceService.issue()` → SubmitWorker.
 *
 * Cierra la brecha de cobertura entre publisher y consumer (cada uno
 * testeado aisladamente). Verifica:
 *   - El evento que `issue()` publica encaja con el handler del worker.
 *   - La cadena de huellas se mantiene entre dos facturas sucesivas.
 *   - El primer registro tiene huellaAnterior=null; el segundo apunta
 *     al primero.
 *
 * Stubs:
 *   - `SignerService.sign` devuelve `{xml + '<signed/>'}` — el signing real
 *     ya está cubierto en `signer.service.spec.ts`.
 *   - `AeatClient` = `StubAeatClient` real (determinista).
 *   - `EventbusService.publish` captura eventos en memoria; el test
 *     los alimenta manualmente al handler — no levantamos NATS.
 *   - `PrismaService` mockeado contra un InMemoryStore compartido que
 *     mantiene estado entre llamadas de los dos servicios.
 */
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  FolioStatus,
  InvoiceStatus,
  InvoiceSubmissionStatus,
  Prisma,
  VerifactuTipoFactura,
} from '@pms/db';
import type { AuthUser } from '../auth';
import type { Env } from '../config/env.schema';
import type { EventbusService } from '../eventbus';
import type { PrismaService } from '../db';
import { StubAeatClient } from './aeat';
import { InvoiceService } from './invoice.service';
import { SignerService } from './signer.service';
import { SubmitWorker } from './submit.worker';

const TENANT_ID = '00000000-0000-0000-0000-0000000000aa';
const PROPERTY_ID = '00000000-0000-0000-0000-0000000000bb';
const FOLIO_ID_A = '00000000-0000-0000-0000-0000000000c1';
const FOLIO_ID_B = '00000000-0000-0000-0000-0000000000c2';

const USER: AuthUser = {
  sub: 'user-1',
  tenantId: TENANT_ID,
  email: 'op@hotel.test',
  roles: ['tenant_admin'],
} as unknown as AuthUser;

interface InvoiceRow {
  id: string;
  tenantId: string;
  propertyId: string;
  folioId: string | null;
  series: string;
  number: number;
  invoiceDate: Date;
  currency: string;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  status: InvoiceStatus;
  tipoFactura: VerifactuTipoFactura;
  customerName: string;
  customerNif: string | null;
  customerAddress: string | null;
  lines: Prisma.JsonValue;
  huella: string | null;
  huellaAnterior: string | null;
  issuedAt: Date | null;
}

interface SubmissionRow {
  id: string;
  tenantId: string;
  invoiceId: string;
  attemptNumber: number;
  status: InvoiceSubmissionStatus;
  requestPayload: string | null;
  responsePayload: string | null;
  responseCode: number | null;
  aeatCsv: string | null;
  errorMessage: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  nextAttemptAt: Date | null;
}

interface FolioRow {
  id: string;
  status: FolioStatus;
  currency: string;
  reservation: { propertyId: string };
  entries: Array<{ type: string; description: string; amount: Prisma.Decimal }>;
}

interface TenantRow {
  id: string;
  nif: string | null;
  razonSocial: string | null;
}

class Store {
  invoices: InvoiceRow[] = [];
  submissions: SubmissionRow[] = [];
  tenants: TenantRow[] = [];
  folios: FolioRow[] = [];
  private idCounter = 0;

  newId(): string {
    this.idCounter += 1;
    return `00000000-0000-0000-0000-${this.idCounter.toString(16).padStart(12, '0')}`;
  }
}

interface CapturedEvent {
  type: string;
  payload: { invoiceId: string; invoiceNumber: string };
}

function makePrisma(store: Store): PrismaService {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),

    tenant: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        store.tenants.find((t) => t.id === where.id) ?? null,
      ),
    },

    folio: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        store.folios.find((f) => f.id === where.id) ?? null,
      ),
    },

    invoice: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const inv = store.invoices.find((i) => i.id === where.id);
        if (!inv) return null;
        const tenant = store.tenants.find((t) => t.id === inv.tenantId);
        return { ...inv, tenant: tenant ? { nif: tenant.nif, razonSocial: tenant.razonSocial } : null };
      }),
      findFirst: vi.fn(
        async (args: {
          where?: {
            id?: string;
            folioId?: string;
            tenantId?: string;
            series?: string;
            status?: unknown;
            huella?: unknown;
          };
          orderBy?: { number?: 'desc'; issuedAt?: 'desc' };
        }) => {
          let rows = store.invoices.slice();
          const w = args.where ?? {};
          if (w.id) rows = rows.filter((r) => r.id === w.id);
          if (w.folioId) rows = rows.filter((r) => r.folioId === w.folioId);
          if (w.tenantId) rows = rows.filter((r) => r.tenantId === w.tenantId);
          if (w.series) rows = rows.filter((r) => r.series === w.series);
          if (w.status && typeof w.status === 'object' && 'not' in (w.status as object)) {
            const not = (w.status as { not: InvoiceStatus }).not;
            rows = rows.filter((r) => r.status !== not);
          }
          if (w.huella && typeof w.huella === 'object' && 'not' in (w.huella as object)) {
            rows = rows.filter((r) => r.huella !== null);
          }
          if (args.orderBy?.number === 'desc') {
            rows = rows.sort((a, b) => b.number - a.number);
          } else if (args.orderBy?.issuedAt === 'desc') {
            rows = rows.sort(
              (a, b) =>
                (b.issuedAt?.getTime() ?? 0) - (a.issuedAt?.getTime() ?? 0),
            );
          }
          return rows[0] ?? null;
        },
      ),
      create: vi.fn(async ({ data }: { data: Omit<InvoiceRow, 'id' | 'status'> & { status?: InvoiceStatus } }) => {
        const id = store.newId();
        const row: InvoiceRow = {
          ...data,
          id,
          status: data.status ?? InvoiceStatus.DRAFT,
        };
        store.invoices.push(row);
        return { id };
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<InvoiceRow> }) => {
          const row = store.invoices.find((i) => i.id === where.id);
          if (!row) throw new Error(`Invoice ${where.id} not found`);
          Object.assign(row, data);
          return row;
        },
      ),
    },

    invoiceSubmission: {
      findFirst: vi.fn(
        async (args: {
          where?: { invoiceId?: string; status?: unknown };
          orderBy?: { attemptNumber?: 'desc' };
        }) => {
          let rows = store.submissions.slice();
          if (args.where?.invoiceId) {
            rows = rows.filter((r) => r.invoiceId === args.where!.invoiceId);
          }
          if (args.where?.status && typeof args.where.status === 'object' && 'in' in (args.where.status as object)) {
            const arr = (args.where.status as { in: InvoiceSubmissionStatus[] }).in;
            rows = rows.filter((r) => arr.includes(r.status));
          }
          if (args.orderBy?.attemptNumber === 'desc') {
            rows = rows.sort((a, b) => b.attemptNumber - a.attemptNumber);
          }
          return rows[0] ?? null;
        },
      ),
      create: vi.fn(async ({ data }: { data: Partial<SubmissionRow> }) => {
        const row: SubmissionRow = {
          id: store.newId(),
          tenantId: data.tenantId!,
          invoiceId: data.invoiceId!,
          attemptNumber: data.attemptNumber!,
          status: data.status ?? InvoiceSubmissionStatus.PENDING,
          requestPayload: null,
          responsePayload: null,
          responseCode: null,
          aeatCsv: null,
          errorMessage: null,
          queuedAt: new Date(),
          startedAt: data.startedAt ?? null,
          completedAt: null,
          nextAttemptAt: data.nextAttemptAt ?? null,
        };
        store.submissions.push(row);
        return { id: row.id, attemptNumber: row.attemptNumber };
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<SubmissionRow> }) => {
          const row = store.submissions.find((s) => s.id === where.id);
          if (!row) throw new Error(`Submission ${where.id} not found`);
          Object.assign(row, data);
          return row;
        },
      ),
    },
  };

  return {
    ...tx,
    withTenant: vi.fn(async <T,>(_ctx: unknown, fn: (tx: unknown) => Promise<T>) => fn(tx)),
  } as unknown as PrismaService;
}

function makeBus(captured: CapturedEvent[]): EventbusService {
  return {
    publish: vi.fn(async (type: string, _ctx: unknown, payload: unknown) => {
      captured.push({ type, payload: payload as CapturedEvent['payload'] });
      return { id: 'e1', sequence: 1, type };
    }),
  } as unknown as EventbusService;
}

function makeSigner(): SignerService {
  return {
    sign: vi.fn(async (_tenantId: string, xml: string) => ({
      xml: `${xml}<signed/>`,
      digestValue: 'fake-digest',
      signatureValue: 'fake-sig',
      signingCertificate: {} as never,
    })),
  } as unknown as SignerService;
}

function makeConfig(): ConfigService<Env, true> {
  return {
    get: (key: keyof Env) => {
      switch (key) {
        case 'NODE_ENV':
          return 'test';
        case 'VERIFACTU_SISTEMA_NOMBRE_RAZON':
          return 'Aubergine PMS S.L.';
        case 'VERIFACTU_SISTEMA_NIF':
          return 'B00000000';
        case 'VERIFACTU_SISTEMA_NOMBRE':
          return 'Aubergine PMS';
        case 'VERIFACTU_SISTEMA_ID':
          return '01';
        case 'VERIFACTU_SISTEMA_VERSION':
          return '0.1.0';
        default:
          return undefined;
      }
    },
  } as unknown as ConfigService<Env, true>;
}

function setupWorld() {
  const store = new Store();
  store.tenants.push({
    id: TENANT_ID,
    nif: 'B12345678',
    razonSocial: 'Hotel Berenjena Boutique S.L.',
  });
  store.folios.push({
    id: FOLIO_ID_A,
    status: FolioStatus.CLOSED,
    currency: 'EUR',
    reservation: { propertyId: PROPERTY_ID },
    entries: [
      { type: 'CHARGE', description: 'Habitación', amount: new Prisma.Decimal('100.00') },
    ],
  });
  store.folios.push({
    id: FOLIO_ID_B,
    status: FolioStatus.CLOSED,
    currency: 'EUR',
    reservation: { propertyId: PROPERTY_ID },
    entries: [
      { type: 'CHARGE', description: 'Habitación', amount: new Prisma.Decimal('200.00') },
    ],
  });

  const captured: CapturedEvent[] = [];
  const prisma = makePrisma(store);
  const bus = makeBus(captured);
  const signer = makeSigner();
  const aeat = new StubAeatClient();
  const config = makeConfig();

  const issuer = new InvoiceService(prisma, bus);
  const worker = new SubmitWorker(prisma, bus, signer, aeat, config);

  return { store, captured, issuer, worker };
}

describe('Verifactu integration: issue → submit (in-memory)', () => {
  it('happy path: issue publishes submit_requested; worker accepts; final state correct', async () => {
    const { store, captured, issuer, worker } = setupWorld();

    const issued = await issuer.issue(USER, 'corr-1', {
      folioId: FOLIO_ID_A,
      customerName: 'Ana Pérez',
      customerNif: '12345678Z',
    });

    expect(issued.status).toBe(InvoiceStatus.ISSUED);
    expect(issued.invoiceNumber).toBe('A-1');

    // El evento publicado encaja con la firma esperada por el worker.
    const requestedEvents = captured.filter(
      (e) => e.type === 'verifactu.invoice.submit_requested',
    );
    expect(requestedEvents).toHaveLength(1);
    const evt = requestedEvents[0]!;
    expect(evt.payload.invoiceId).toBe(issued.id);
    expect(evt.payload.invoiceNumber).toBe('A-1');

    // El worker procesa ese mismo payload sin tocar nada más.
    const result = await worker.handle(evt.payload, 1);
    expect(result).toBe('ack');

    const inv = store.invoices.find((i) => i.id === issued.id)!;
    expect(inv.status).toBe(InvoiceStatus.ACCEPTED);
    expect(inv.huella).toMatch(/^[0-9a-f]{64}$/);
    expect(inv.huellaAnterior).toBeNull();

    // El worker publica el evento downstream submitted.
    const submitted = captured.filter((e) => e.type === 'verifactu.invoice.submitted');
    expect(submitted).toHaveLength(1);
  });

  it('two invoices chain via huella (invoice #2.huellaAnterior == invoice #1.huella)', async () => {
    const { store, captured, issuer, worker } = setupWorld();

    const i1 = await issuer.issue(USER, 'corr-1', {
      folioId: FOLIO_ID_A,
      customerName: 'Ana Pérez',
      customerNif: '12345678Z',
    });
    const evt1 = captured.find((e) => e.type === 'verifactu.invoice.submit_requested')!;
    await worker.handle(evt1.payload, 1);

    const i2 = await issuer.issue(USER, 'corr-2', {
      folioId: FOLIO_ID_B,
      customerName: 'Bob Smith',
      customerNif: 'X1234567L',
    });
    const evt2 = captured
      .filter((e) => e.type === 'verifactu.invoice.submit_requested')
      .at(-1)!;
    await worker.handle(evt2.payload, 1);

    const inv1 = store.invoices.find((i) => i.id === i1.id)!;
    const inv2 = store.invoices.find((i) => i.id === i2.id)!;

    expect(inv1.huella).toBeTruthy();
    expect(inv1.huellaAnterior).toBeNull();
    expect(inv2.huella).toBeTruthy();
    expect(inv2.huellaAnterior).toBe(inv1.huella);
    expect(inv2.huella).not.toBe(inv1.huella);

    expect(inv1.status).toBe(InvoiceStatus.ACCEPTED);
    expect(inv2.status).toBe(InvoiceStatus.ACCEPTED);
  });
});
