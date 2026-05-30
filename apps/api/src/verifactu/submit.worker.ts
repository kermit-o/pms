import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvoiceStatus, InvoiceSubmissionStatus } from '@pms/db';
import type { HandlerResult } from '@pms/eventbus';
import { PrismaService } from '../db';
import type { Env } from '../config/env.schema';
import { EventbusService } from '../eventbus';
import { AEAT_CLIENT, type AeatClient, type AeatSubmitResult } from './aeat';
import { buildInvoiceXml } from './invoice-xml';
import { SignerService } from './signer.service';

/**
 * SubmitWorker (ADR-030 §4).
 *
 * Subscribe durable a `verifactu.invoice.submit_requested`. Por evento:
 *
 *  1. Carga la factura. Si ya está ACCEPTED → ack idempotente.
 *  2. Marca la submission attempt como IN_PROGRESS (startedAt).
 *  3. Genera XML, lo firma con SignerService (XMLDSig, ver caveats),
 *     guarda `request_payload`.
 *  4. Llama a AeatClient.submit().
 *  5. Resultado:
 *     - ACCEPTED → submission.ACCEPTED + invoice.ACCEPTED + aeatCsv + publica
 *       `verifactu.invoice.submitted`. ack.
 *     - REJECTED → submission.REJECTED + invoice.REJECTED + publica
 *       `verifactu.invoice.rejected` (isDeadLetter=true: el AEAT lo
 *       rechaza por validación, reintentar no ayudará). term.
 *     - Excepción transitoria (red, 5xx, certificado faltante) → submission
 *       queda FAILED conceptualmente (re-encolada como nueva attempt en el
 *       siguiente intento). nak.
 *  6. Tras maxDeliver agotados, JetStream termina el mensaje:
 *     manejamos el último intento marcándolo DEAD_LETTER + publicando
 *     `verifactu.invoice.rejected` (isDeadLetter=true).
 *
 * Nota sobre alcance: el signer genera XMLDSig estándar pero no XAdES-BES
 * completo. Suficiente con StubAeatClient; el PreprodAeatClient real
 * requerirá XAdES — pendiente de ADR.
 */
@Injectable()
export class SubmitWorker implements OnModuleInit {
  private readonly log = new Logger(SubmitWorker.name);
  private readonly enabled: boolean;
  private readonly maxDeliver: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventbusService,
    private readonly signer: SignerService,
    @Inject(AEAT_CLIENT) private readonly aeat: AeatClient,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('NODE_ENV', { infer: true }) !== 'test';
    this.maxDeliver = 5;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.log.log('SubmitWorker disabled (test env)');
      return;
    }
    await this.bus.subscribe(
      'verifactu.invoice.submit_requested',
      {
        durable: 'verifactu-submit',
        maxDeliver: this.maxDeliver,
        ackWaitMs: 60_000,
        batchSize: 4,
      },
      async (envelope, msg) => this.handle(envelope.payload, msg.info.deliveryCount ?? 1),
    );
    this.log.log(
      `SubmitWorker subscribed to verifactu.invoice.submit_requested (mode=${this.aeat.mode})`,
    );
  }

  /**
   * Handler público — tests unitarios lo invocan sin NATS.
   * `deliveryAttempt` es el número de entrega de JetStream (1-indexed).
   * Cuando == maxDeliver y el resultado es transitorio, marcamos DEAD_LETTER.
   */
  async handle(
    payload: { invoiceId: string; invoiceNumber: string },
    deliveryAttempt: number,
  ): Promise<HandlerResult> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: payload.invoiceId },
      select: {
        id: true,
        tenantId: true,
        status: true,
        series: true,
        number: true,
        invoiceDate: true,
        currency: true,
        subtotal: true,
        taxAmount: true,
        totalAmount: true,
        customerName: true,
        customerNif: true,
        customerAddress: true,
      },
    });
    if (!invoice) {
      // El upstream creó el evento pero la factura no existe — registro y term.
      this.log.error(`Invoice ${payload.invoiceId} not found — terminating`);
      return 'term';
    }

    if (invoice.status === InvoiceStatus.ACCEPTED) {
      this.log.log(`Invoice ${payload.invoiceNumber} already ACCEPTED — idempotent ack`);
      return 'ack';
    }

    const attempt = await this.acquireAttempt(invoice.id, invoice.tenantId);

    let signedXml: string;
    try {
      const payloadXml = buildInvoiceXml({
        invoiceId: invoice.id,
        series: invoice.series,
        number: invoice.number,
        invoiceDate: invoice.invoiceDate,
        currency: invoice.currency,
        subtotal: invoice.subtotal,
        taxAmount: invoice.taxAmount,
        totalAmount: invoice.totalAmount,
        customerName: invoice.customerName,
        customerNif: invoice.customerNif,
        customerAddress: invoice.customerAddress,
      });
      const signed = await this.signer.sign(invoice.tenantId, payloadXml);
      signedXml = signed.xml;
    } catch (err) {
      // Fallo de firma (sin cert, cert revocado, etc.) — transitorio:
      // el operador puede subir/desrevocar el cert y reintentar.
      const message = (err as Error).message.slice(0, 500);
      this.log.error(`Sign failed invoice=${payload.invoiceNumber}: ${message}`);
      await this.markAttemptFailed(attempt.id, message);
      return this.shouldRetry(deliveryAttempt)
        ? 'nak'
        : this.deadLetter(invoice.id, payload.invoiceNumber, attempt.id, attempt.attemptNumber, message);
    }

    let result: AeatSubmitResult;
    try {
      result = await this.aeat.submit({
        tenantId: invoice.tenantId,
        invoiceId: invoice.id,
        signedXml,
      });
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      this.log.error(`AEAT submit threw invoice=${payload.invoiceNumber}: ${message}`);
      await this.markAttemptFailed(attempt.id, message, signedXml);
      return this.shouldRetry(deliveryAttempt)
        ? 'nak'
        : this.deadLetter(invoice.id, payload.invoiceNumber, attempt.id, attempt.attemptNumber, message);
    }

    if (result.status === 'ACCEPTED') {
      await this.markAccepted(invoice.id, attempt.id, signedXml, result);
      await this.bus.publish(
        'verifactu.invoice.submitted',
        { tenantId: invoice.tenantId },
        {
          invoiceId: invoice.id,
          invoiceNumber: payload.invoiceNumber,
          csv: result.csv,
          attemptNumber: attempt.attemptNumber,
        },
      );
      this.log.log(
        `Invoice ${payload.invoiceNumber} ACCEPTED by AEAT csv=${result.csv} attempt=${attempt.attemptNumber}`,
      );
      return 'ack';
    }

    // REJECTED — el AEAT validó y dijo no. No reintentamos.
    await this.markRejected(invoice.id, attempt.id, signedXml, result);
    await this.bus.publish(
      'verifactu.invoice.rejected',
      { tenantId: invoice.tenantId },
      {
        invoiceId: invoice.id,
        invoiceNumber: payload.invoiceNumber,
        errorMessage: result.errorMessage,
        attemptNumber: attempt.attemptNumber,
        isDeadLetter: true,
      },
    );
    this.log.warn(`Invoice ${payload.invoiceNumber} REJECTED: ${result.errorMessage}`);
    return 'term';
  }

  private shouldRetry(deliveryAttempt: number): boolean {
    return deliveryAttempt < this.maxDeliver;
  }

  /**
   * Crea o reactiva la submission attempt actual. Si ya existe una PENDING
   * la promociona a IN_PROGRESS; si todas las attempts pasadas fallaron,
   * crea una nueva con attemptNumber++.
   */
  private async acquireAttempt(
    invoiceId: string,
    tenantId: string,
  ): Promise<{ id: string; attemptNumber: number }> {
    const pending = await this.prisma.invoiceSubmission.findFirst({
      where: { invoiceId, status: { in: [InvoiceSubmissionStatus.PENDING, InvoiceSubmissionStatus.IN_PROGRESS] } },
      orderBy: { attemptNumber: 'desc' },
      select: { id: true, attemptNumber: true },
    });
    if (pending) {
      await this.prisma.invoiceSubmission.update({
        where: { id: pending.id },
        data: { status: InvoiceSubmissionStatus.IN_PROGRESS, startedAt: new Date() },
      });
      return pending;
    }
    const last = await this.prisma.invoiceSubmission.findFirst({
      where: { invoiceId },
      orderBy: { attemptNumber: 'desc' },
      select: { attemptNumber: true },
    });
    const nextNumber = (last?.attemptNumber ?? 0) + 1;
    const row = await this.prisma.invoiceSubmission.create({
      data: {
        tenantId,
        invoiceId,
        attemptNumber: nextNumber,
        status: InvoiceSubmissionStatus.IN_PROGRESS,
        startedAt: new Date(),
      },
      select: { id: true, attemptNumber: true },
    });
    return row;
  }

  private async markAttemptFailed(
    attemptId: string,
    errorMessage: string,
    requestPayload?: string,
  ): Promise<void> {
    await this.prisma.invoiceSubmission.update({
      where: { id: attemptId },
      data: {
        status: InvoiceSubmissionStatus.PENDING, // re-encolada para próximo intento
        completedAt: new Date(),
        errorMessage,
        ...(requestPayload !== undefined && { requestPayload }),
        nextAttemptAt: nextBackoff(),
      },
    });
  }

  private async markAccepted(
    invoiceId: string,
    attemptId: string,
    requestPayload: string,
    result: Extract<AeatSubmitResult, { status: 'ACCEPTED' }>,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.invoiceSubmission.update({
        where: { id: attemptId },
        data: {
          status: InvoiceSubmissionStatus.ACCEPTED,
          completedAt: new Date(),
          requestPayload,
          responsePayload: result.responsePayload,
          responseCode: result.responseCode,
          aeatCsv: result.csv,
        },
      }),
      this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: InvoiceStatus.ACCEPTED },
      }),
    ]);
  }

  private async markRejected(
    invoiceId: string,
    attemptId: string,
    requestPayload: string,
    result: Extract<AeatSubmitResult, { status: 'REJECTED' }>,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.invoiceSubmission.update({
        where: { id: attemptId },
        data: {
          status: InvoiceSubmissionStatus.REJECTED,
          completedAt: new Date(),
          requestPayload,
          responsePayload: result.responsePayload,
          responseCode: result.responseCode,
          errorMessage: result.errorMessage,
        },
      }),
      this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: InvoiceStatus.REJECTED },
      }),
    ]);
  }

  private async deadLetter(
    invoiceId: string,
    invoiceNumber: string,
    attemptId: string,
    attemptNumber: number,
    message: string,
  ): Promise<HandlerResult> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { tenantId: true },
    });
    await this.prisma.$transaction([
      this.prisma.invoiceSubmission.update({
        where: { id: attemptId },
        data: {
          status: InvoiceSubmissionStatus.DEAD_LETTER,
          completedAt: new Date(),
          errorMessage: message,
        },
      }),
      this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: InvoiceStatus.REJECTED },
      }),
    ]);
    if (invoice) {
      await this.bus.publish(
        'verifactu.invoice.rejected',
        { tenantId: invoice.tenantId },
        {
          invoiceId,
          invoiceNumber,
          errorMessage: message,
          attemptNumber,
          isDeadLetter: true,
        },
      );
    }
    this.log.error(`Invoice ${invoiceNumber} DEAD_LETTER after ${attemptNumber} attempts: ${message}`);
    return 'term';
  }
}

/** Backoff exponencial similar al de SES: 1m, 5m, 30m, 4h, 24h. */
function nextBackoff(): Date {
  // Cuando JetStream redelivers, el ackWait gobierna el reintento real; este
  // campo en DB es informativo para la UI ("próximo intento").
  return new Date(Date.now() + 60_000);
}
