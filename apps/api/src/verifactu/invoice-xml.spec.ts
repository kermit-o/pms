import { describe, expect, it } from 'vitest';
import { buildInvoiceXml } from './invoice-xml';

describe('buildInvoiceXml', () => {
  const base = {
    invoiceId: 'inv-1',
    series: 'A',
    number: 42,
    invoiceDate: new Date('2026-05-30T10:00:00Z'),
    currency: 'EUR',
    subtotal: '100.00',
    taxAmount: '10.00',
    totalAmount: '110.00',
    customerName: 'Ana Pérez',
    customerNif: '12345678Z',
    customerAddress: 'Calle Mayor 1',
  };

  it('produces stable canonical XML with all fields', () => {
    const xml = buildInvoiceXml(base);
    expect(xml).toBe(
      '<AubergineVerifactuInvoiceStub>' +
        '<InvoiceId>inv-1</InvoiceId>' +
        '<Series>A</Series>' +
        '<Number>42</Number>' +
        '<InvoiceDate>2026-05-30</InvoiceDate>' +
        '<Currency>EUR</Currency>' +
        '<Subtotal>100.00</Subtotal>' +
        '<TaxAmount>10.00</TaxAmount>' +
        '<TotalAmount>110.00</TotalAmount>' +
        '<Customer>' +
        '<Name>Ana Pérez</Name>' +
        '<Nif>12345678Z</Nif>' +
        '<Address>Calle Mayor 1</Address>' +
        '</Customer>' +
        '</AubergineVerifactuInvoiceStub>',
    );
  });

  it('omits Nif and Address when null', () => {
    const xml = buildInvoiceXml({ ...base, customerNif: null, customerAddress: null });
    expect(xml).not.toContain('<Nif>');
    expect(xml).not.toContain('<Address>');
    expect(xml).toContain('<Name>Ana Pérez</Name>');
  });

  it('escapes XML-special characters in string fields', () => {
    const xml = buildInvoiceXml({
      ...base,
      customerName: 'Tom & Jerry "Co" <hotel>',
    });
    expect(xml).toContain('<Name>Tom &amp; Jerry &quot;Co&quot; &lt;hotel&gt;</Name>');
  });
});
