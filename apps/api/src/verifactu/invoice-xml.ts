import type { Prisma } from '@pms/db';

/**
 * Serializa una factura a XML canónico (C14N 1.0 simplificado).
 *
 * **STUB — pendiente del payload Verifactu real.** El XSD oficial define
 * un schema bastante más rico (cabecera, sujeto, líneas con desglose IVA,
 * etc.). Este builder genera un XML mínimo y bien formado que sirve para
 * desarrollar el SubmitWorker, el StubAeatClient y los tests end-to-end.
 *
 * Reemplazarlo por el generador real es parte del trabajo de "Verifactu
 * compliant XML" que va junto al ADR de XAdES-BES (W3+ del Sprint 14).
 *
 * Reglas de canonicalización aplicadas:
 *  - Sin saltos de línea ni indentación entre elementos.
 *  - Atributos por orden alfabético (n/a aquí — sin atributos).
 *  - Strings escapadas (&, <, >, ").
 *  - UTF-8 implícito; el XML no lleva declaración (`<?xml ?>`) para no
 *    interferir con la inserción de la firma enveloped.
 */
export interface InvoicePayloadInput {
  invoiceId: string;
  series: string;
  number: number;
  invoiceDate: Date;
  currency: string;
  subtotal: Prisma.Decimal | string;
  taxAmount: Prisma.Decimal | string;
  totalAmount: Prisma.Decimal | string;
  customerName: string;
  customerNif: string | null;
  customerAddress: string | null;
}

export function buildInvoiceXml(input: InvoicePayloadInput): string {
  const root = 'AubergineVerifactuInvoiceStub';
  const dateIso = input.invoiceDate.toISOString().slice(0, 10);
  return (
    `<${root}>` +
    `<InvoiceId>${esc(input.invoiceId)}</InvoiceId>` +
    `<Series>${esc(input.series)}</Series>` +
    `<Number>${input.number}</Number>` +
    `<InvoiceDate>${esc(dateIso)}</InvoiceDate>` +
    `<Currency>${esc(input.currency)}</Currency>` +
    `<Subtotal>${esc(input.subtotal.toString())}</Subtotal>` +
    `<TaxAmount>${esc(input.taxAmount.toString())}</TaxAmount>` +
    `<TotalAmount>${esc(input.totalAmount.toString())}</TotalAmount>` +
    `<Customer>` +
    `<Name>${esc(input.customerName)}</Name>` +
    (input.customerNif ? `<Nif>${esc(input.customerNif)}</Nif>` : '') +
    (input.customerAddress ? `<Address>${esc(input.customerAddress)}</Address>` : '') +
    `</Customer>` +
    `</${root}>`
  );
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
