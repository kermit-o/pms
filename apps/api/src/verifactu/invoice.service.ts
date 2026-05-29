import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FolioStatus, InvoiceStatus, Prisma } from '@pms/db';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';
import type { AuthUser } from '../auth';
import { computeInvoiceTotals, type FolioEntrySnapshot } from './invoice-totals';

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
      // 1. Lock for the (tenant, series) sequence.
      const lockKey = `${user.tenantId}:${series}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('verifactu-invoice'), hashtext(${lockKey}))`;

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

      // 6. Insert the invoice.
      const created = await tx.invoice.create({
        data: {
          tenantId: user.tenantId,
          propertyId: folio.reservation.propertyId,
          folioId: folio.id,
          series,
          number: nextNumber,
          invoiceDate: new Date(),
          currency: folio.currency,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          status: InvoiceStatus.ISSUED,
          customerName: input.customerName.trim(),
          customerNif: input.customerNif?.trim() || null,
          customerAddress: input.customerAddress?.trim() || null,
          lines: totals.lines as unknown as Prisma.InputJsonValue,
          issuedAt: new Date(),
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
}
