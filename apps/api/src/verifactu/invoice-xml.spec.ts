import { describe, expect, it } from 'vitest';
import { buildVerifactuRegistroAlta } from './invoice-xml';

const baseInput = {
  invoiceId: 'inv-1',
  emisor: { nif: 'B12345678', nombreRazon: 'Hotel Test S.L.' },
  series: 'A',
  number: 42,
  invoiceDate: new Date('2026-05-30T10:00:00Z'),
  currency: 'EUR',
  tipoFactura: 'F1',
  descripcionOperacion: 'Estancia hotelera',
  subtotal: '100.00',
  taxAmount: '10.00',
  totalAmount: '110.00',
  customerName: 'Ana Pérez',
  customerNif: '12345678Z',
  customerAddress: 'Calle Mayor 1',
  huella: 'a'.repeat(64),
  huellaAnterior: null,
  sistema: {
    nombreRazon: 'Aubergine PMS S.L.',
    nif: 'B99999999',
    nombreSistemaInformatico: 'Aubergine PMS',
    idSistemaInformatico: '01',
    version: '0.1.0',
    numeroInstalacion: 'tenant-uuid-1',
  },
  generatedAt: new Date('2026-05-30T10:00:00.000Z'),
};

describe('buildVerifactuRegistroAlta', () => {
  it('produces RegFactuSistemaFacturacion as root with the right structure', () => {
    const xml = buildVerifactuRegistroAlta(baseInput);
    expect(xml.startsWith('<RegFactuSistemaFacturacion ')).toBe(true);
    expect(xml.endsWith('</RegFactuSistemaFacturacion>')).toBe(true);
    expect(xml).toContain('<RegistroAlta>');
    expect(xml).toContain('</RegistroAlta>');
  });

  it('includes IDFactura with emisor NIF, series-number and DD-MM-YYYY date', () => {
    const xml = buildVerifactuRegistroAlta(baseInput);
    expect(xml).toContain('<NIF>B12345678</NIF>');
    expect(xml).toContain('<NombreRazon>Hotel Test S.L.</NombreRazon>');
    expect(xml).toContain('<NumSerieFactura>A-42</NumSerieFactura>');
    expect(xml).toContain('<FechaExpedicionFactura>30-05-2026</FechaExpedicionFactura>');
  });

  it('emits Destinatarios when the customer has NIF (F1)', () => {
    const xml = buildVerifactuRegistroAlta(baseInput);
    expect(xml).toContain('<Destinatarios>');
    expect(xml).toContain('<NIF>12345678Z</NIF>');
  });

  it('omits Destinatarios when there is no customer NIF (F2)', () => {
    const xml = buildVerifactuRegistroAlta({
      ...baseInput,
      tipoFactura: 'F2',
      customerNif: null,
    });
    expect(xml).not.toContain('<Destinatarios>');
  });

  it('serializes <PrimerRegistro>S</PrimerRegistro> when there is no previous huella', () => {
    const xml = buildVerifactuRegistroAlta(baseInput);
    expect(xml).toContain('<PrimerRegistro>S</PrimerRegistro>');
    expect(xml).not.toContain('<RegistroAnterior>');
  });

  it('serializes <RegistroAnterior> with the previous huella when chaining', () => {
    const prev = 'b'.repeat(64);
    const xml = buildVerifactuRegistroAlta({ ...baseInput, huellaAnterior: prev });
    expect(xml).toContain('<RegistroAnterior>');
    expect(xml).toContain(`<Huella>${prev}</Huella>`);
    expect(xml).not.toContain('<PrimerRegistro>');
  });

  it('emits SistemaInformatico with all 6 fields from input.sistema', () => {
    const xml = buildVerifactuRegistroAlta(baseInput);
    expect(xml).toContain('<SistemaInformatico>');
    expect(xml).toContain('<NombreRazon>Aubergine PMS S.L.</NombreRazon>');
    expect(xml).toContain('<NIF>B99999999</NIF>');
    expect(xml).toContain('<NombreSistemaInformatico>Aubergine PMS</NombreSistemaInformatico>');
    expect(xml).toContain('<IdSistemaInformatico>01</IdSistemaInformatico>');
    expect(xml).toContain('<Version>0.1.0</Version>');
    expect(xml).toContain('<NumeroInstalacion>tenant-uuid-1</NumeroInstalacion>');
  });

  it('uses TipoHuella=01 (SHA-256) and emits the current Huella', () => {
    const xml = buildVerifactuRegistroAlta(baseInput);
    expect(xml).toContain('<TipoHuella>01</TipoHuella>');
    expect(xml).toContain(`<Huella>${'a'.repeat(64)}</Huella>`);
  });

  it('emits CuotaTotal + ImporteTotal as 2-decimal strings', () => {
    const xml = buildVerifactuRegistroAlta(baseInput);
    expect(xml).toContain('<CuotaTotal>10.00</CuotaTotal>');
    expect(xml).toContain('<ImporteTotal>110.00</ImporteTotal>');
  });

  it('emits FechaHoraHusoGenRegistro in ISO-8601 with timezone', () => {
    const xml = buildVerifactuRegistroAlta(baseInput);
    expect(xml).toContain(
      '<FechaHoraHusoGenRegistro>2026-05-30T10:00:00.000Z</FechaHoraHusoGenRegistro>',
    );
  });

  it('escapes XML special characters in the descripción and customer name', () => {
    const xml = buildVerifactuRegistroAlta({
      ...baseInput,
      descripcionOperacion: 'Bed & Breakfast <noche extra>',
      customerName: 'Tom "Cat" & Co.',
    });
    expect(xml).toContain(
      '<DescripcionOperacion>Bed &amp; Breakfast &lt;noche extra&gt;</DescripcionOperacion>',
    );
    expect(xml).toContain('<NombreRazon>Tom &quot;Cat&quot; &amp; Co.</NombreRazon>');
  });
});
