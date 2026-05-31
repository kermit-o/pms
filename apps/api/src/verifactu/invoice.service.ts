import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FolioStatus, InvoiceStatus, Prisma, VerifactuTipoFactura } from '@pms/db';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';
import type { AuthUser } from '../auth';
import { computeHuella, formatFechaExpedicion } from './huella';
import { computeInvoiceTotals, type FolioEntrySnapshot } from './invoice-totals';

/** ADR-032 §3 — factura simplificada permitida hasta 3.000€ en hostelería. */
const F2_MAX_TOTAL_EUR = 3_000;

export interface IssueInvoiceInput {
  folioId: string;
  customerName: string;
  customerNif?: string | null;
  customerAddress?: string | null;
  series?: string;
}

export interface IssuedInvoice {
  id: string;
  series: string;
  number: number;
  invoiceNumber: string;
  totalAmount: string;
  status: InvoiceStatus;
  /** True si la factura ya existía (idempotent return). */
  alreadyExisted: boolean;
}

/**
 * InvoiceService — emite la factura inmutable a partir de un folio cerrado.
 *
 * Concurrencia: la asignación del número de factura usa un advisory lock
 * `pg_advisory_xact_lock` keyed por (tenant, series). Dos llamadas paralelas
 * sobre la misma serie se serializan; el lock se libera al commit.
 *
 * Idempotencia: si ya existe una factura no-VOIDED para el `folioId`, se
 * devuelve sin crear duplicado. El advisory lock protege contra carrera.
 *
 * Tras commit, publica `verifactu.invoice.submit_requested`. El SubmitWorker
 * (no incluido en este commit) consumirá el evento.
 */
@Injectable()
export class InvoiceService {
  private readonly log = new Logger(InvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventbusService,
  ) {}

  async issue(
    user: AuthUser,
    correlationId: string,
    input: IssueInvoiceInput,
  ): Promise<IssuedInvoice> {
    if (!input.customerName.trim()) {
      throw new BadRequestException('customerName is required');
    }
    const series = (input.series ?? 'A').toUpperCase();
    if (!/^[A-Z][A-Z0-9-]{0,7}$/.test(series)) {
      throw new BadRequestException(
        `Invalid invoice series '${series}' (expected /^[A-Z][A-Z0-9-]{0,7}$/)`,
      );
    }
    const ctx = {
      tenantId: user.tenantId,
      actorId: user.sub,
      correlationId,
    };

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      // 1a. Lock for the (tenant, series) sequence (assigns next `number`).
      const seriesLockKey = `${user.tenantId}:${series}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('verifactu-invoice'), hashtext(${seriesLockKey}))`;

      // 1b. Lock for the per-tenant huella chain (serializes huella_anterior
      //     reads). Distinct namespace so it doesn't conflict with 1a if
      //     two emissions in different series race.
      const chainLockKey = user.tenantId;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('verifactu-chain'), hashtext(${chainLockKey}))`;

      // 1c. Verify the emisor's NIF + razón social are set on the tenant.
      //     Sin esto, el RegistroAlta no se puede serializar (IDEmisorFactura).
      const tenant = await tx.tenant.findUnique({
        where: { id: user.tenantId },
        select: { nif: true, razonSocial: true },
      });
      if (!tenant?.nif || !tenant.razonSocial) {
        throw new BadRequestException(
          'Tenant missing NIF or razón social — configure them under /admin/billing before issuing invoices',
        );
      }

      // 2. Load the folio and its entries.
      const folio = await tx.folio.findFirst({
        where: { id: input.folioId },
        select: {
          id: true,
          status: true,
          currency: true,
          reservation: { select: { propertyId: true } },
          entries: {
            select: { type: true, description: true, amount: true },
            orderBy: { postedAt: 'asc' },
          },
        },
      });
      if (!folio) throw new NotFoundException(`Folio ${input.folioId} not found`);
      if (folio.status !== FolioStatus.CLOSED && folio.status !== FolioStatus.SETTLED) {
        throw new ConflictException(
          `Folio in status ${folio.status} cannot be invoiced (must be CLOSED or SETTLED)`,
        );
      }

      // 3. Idempotency — if an active invoice already exists for this folio, return it.
      const existing = await tx.invoice.findFirst({
        where: { folioId: input.folioId, status: { not: InvoiceStatus.VOIDED } },
        select: {
          id: true,
          series: true,
          number: true,
          totalAmount: true,
          status: true,
        },
      });
      if (existing) {
        return {
          id: existing.id,
          series: existing.series,
          number: existing.number,
          invoiceNumber: `${existing.series}-${existing.number}`,
          totalAmount: existing.totalAmount.toFixed(2),
          status: existing.status,
          alreadyExisted: true,
          published: false,
        };
      }

      // 4. Compute totals + lines.
      const snapshot: FolioEntrySnapshot[] = folio.entries.map((e) => ({
        type: e.type,
        description: e.description,
        amount: e.amount,
      }));
      const totals = computeInvoiceTotals(snapshot);

      // 5. Allocate the next number in series.
      const last = await tx.invoice.findFirst({
        where: { series },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const nextNumber = (last?.number ?? 0) + 1;

      // 5b. Heuristic F1/F2 (ADR-032 §3): F2 if no NIF AND total ≤ 3.000 €,
      //     F1 otherwise (default for cases with NIF or high-value invoices).
      const customerNif = input.customerNif?.trim() || null;
      const tipoFactura =
        !customerNif && totals.totalAmount.lessThanOrEqualTo(F2_MAX_TOTAL_EUR)
          ? VerifactuTipoFactura.F2
          : VerifactuTipoFactura.F1;

      // 5c. Compute the huella by finding the last chained invoice of this
      //     emisor (any series — the chain is per-emisor, ADR-032 §4). The
      //     advisory lock in 1b serializes this read across emissions.
      const lastChained = await tx.invoice.findFirst({
        where: { tenantId: user.tenantId, huella: { not: null } },
        orderBy: { issuedAt: 'desc' },
        select: { huella: true },
      });
      const huellaAnterior = lastChained?.huella ?? null;

      const issuedAt = new Date();
      const huella = computeHuella(
        {
          emisorNif: tenant.nif,
          numSerieFactura: `${series}-${nextNumber}`,
          fechaExpedicionFactura: formatFechaExpedicion(issuedAt),
          tipoFactura,
          cuotaTotal: totals.taxAmount.toFixed(2),
          importeTotal: totals.totalAmount.toFixed(2),
        },
        huellaAnterior,
      );

      // 6. Insert the invoice.
      const created = await tx.invoice.create({
        data: {
          tenantId: user.tenantId,
          propertyId: folio.reservation.propertyId,
          folioId: folio.id,
          series,
          number: nextNumber,
          invoiceDate: issuedAt,
          currency: folio.currency,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          status: InvoiceStatus.ISSUED,
          tipoFactura,
          customerName: input.customerName.trim(),
          customerNif,
          customerAddress: input.customerAddress?.trim() || null,
          lines: totals.lines as unknown as Prisma.InputJsonValue,
          huella,
          huellaAnterior,
          issuedAt,
        },
        select: { id: true },
      });

      // 7. Enqueue the first submission attempt (PENDING — worker picks it up).
      await tx.invoiceSubmission.create({
        data: {
          tenantId: user.tenantId,
          invoiceId: created.id,
          attemptNumber: 1,
          nextAttemptAt: new Date(),
        },
      });

      return {
        id: created.id,
        series,
        number: nextNumber,
        invoiceNumber: `${series}-${nextNumber}`,
        totalAmount: totals.totalAmount.toFixed(2),
        status: InvoiceStatus.ISSUED,
        alreadyExisted: false,
        published: true,
      };
    });

    if (result.published) {
      await this.events.publish('verifactu.invoice.submit_requested', ctx, {
        invoiceId: result.id,
        invoiceNumber: result.invoiceNumber,
      });
      this.log.log(
        `Invoice issued tenant=${user.tenantId} folio=${input.folioId} invoice=${result.invoiceNumber} total=${result.totalAmount}`,
      );
    }

    const { published: _published, ...issued } = result;
    return issued;
  }

  /**
   * Lista los intentos de envío AEAT de una factura, más reciente primero.
   * Usado por la UI de histórico/reintento.
   */
  async listSubmissions(
    user: AuthUser,
    correlationId: string,
    invoiceId: string,
  ): Promise<InvoiceSubmissionView[]> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    const rows = await this.prisma.withTenant(ctx, async (tx) => {
      return tx.invoiceSubmission.findMany({
        where: { invoiceId },
        orderBy: { attemptNumber: 'desc' },
        select: {
          id: true,
          attemptNumber: true,
          status: true,
          responseCode: true,
          aeatCsv: true,
          errorMessage: true,
          queuedAt: true,
          startedAt: true,
          completedAt: true,
          nextAttemptAt: true,
        },
      });
    });
    return rows.map((r) => ({
      id: r.id,
      attemptNumber: r.attemptNumber,
      status: r.status,
      responseCode: r.responseCode,
      aeatCsv: r.aeatCsv,
      errorMessage: r.errorMessage,
      queuedAt: r.queuedAt,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      nextAttemptAt: r.nextAttemptAt,
    }));
  }

  /**
   * Re-encola un envío AEAT. Operación de operador desde la UI cuando un
   * intento previo falló o quedó DEAD_LETTER. Rechaza con Conflict si la
   * factura ya está ACCEPTED (no tiene sentido reintentar) o si ya hay un
   * intento PENDING/IN_PROGRESS (evita duplicados).
   */
  async requeueSubmission(
    user: AuthUser,
    correlationId: string,
    invoiceId: string,
  ): Promise<{ invoiceId: string; invoiceNumber: string }> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };

    const invoice = await this.prisma.withTenant(ctx, async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { id: invoiceId },
        select: { id: true, status: true, series: true, number: true },
      });
      if (!inv) throw new NotFoundException(`Invoice ${invoiceId} not found`);
      if (inv.status === InvoiceStatus.ACCEPTED) {
        throw new ConflictException('Invoice already ACCEPTED by AEAT');
      }
      const pending = await tx.invoiceSubmission.findFirst({
        where: {
          invoiceId,
          status: { in: ['PENDING', 'IN_PROGRESS'] },
        },
        select: { id: true },
      });
      if (pending) {
        throw new ConflictException('A submission attempt is already pending or in progress');
      }
      return inv;
    });

    const invoiceNumber = `${invoice.series}-${invoice.number}`;
    await this.events.publish('verifactu.invoice.submit_requested', ctx, {
      invoiceId: invoice.id,
      invoiceNumber,
    });
    this.log.log(
      `Requeued invoice ${invoiceNumber} tenant=${user.tenantId} by ${user.sub}`,
    );
    return { invoiceId: invoice.id, invoiceNumber };
  }

  /**
   * Busca la factura activa de un folio (cualquier estado excepto VOIDED).
   * Devuelve `null` si no existe. Usado por la UI para mostrar la factura
   * ya emitida en lugar del formulario de emisión.
   */
  async findByFolio(
    user: AuthUser,
    correlationId: string,
    folioId: string,
  ): Promise<IssuedInvoice | null> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    const row = await this.prisma.withTenant(ctx, async (tx) => {
      return tx.invoice.findFirst({
        where: { folioId, status: { not: InvoiceStatus.VOIDED } },
        select: {
          id: true,
          series: true,
          number: true,
          totalAmount: true,
          status: true,
        },
      });
    });
    if (!row) return null;
    return {
      id: row.id,
      series: row.series,
      number: row.number,
      invoiceNumber: `${row.series}-${row.number}`,
      totalAmount: row.totalAmount.toString(),
      status: row.status,
      alreadyExisted: true,
    };
  }
}

export interface InvoiceSubmissionView {
  id: string;
  attemptNumber: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'ACCEPTED' | 'REJECTED' | 'DEAD_LETTER';
  responseCode: number | null;
  aeatCsv: string | null;
  errorMessage: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  nextAttemptAt: Date | null;
}
