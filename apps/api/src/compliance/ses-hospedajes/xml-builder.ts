/**
 * SES.HOSPEDAJES XML rendering — RD 933/2021 (Guardia Civil).
 *
 * NOTE: this is a placeholder schema that captures the *shape* of a daily
 * report (establishment header + per-guest rows). The real `comunicacion`
 * XSD (with namespaces, signature blocks, etc.) is integrated in the
 * production sender; the structure here is forward-compatible.
 */

export interface SesEstablishment {
  code: string;
  name: string;
  cif: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
}

export interface SesGuestRecord {
  documentType: string | null;
  documentNumber: string | null;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  nationality: string | null;
  arrivalDate: string;
  departureDate: string;
}

export interface SesReportInput {
  businessDate: string;
  establishment: SesEstablishment;
  guests: SesGuestRecord[];
}

const escapeXml = (raw: string | null | undefined): string => {
  if (raw == null) return '';
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

export function buildSesXml(input: SesReportInput): string {
  const e = input.establishment;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<comunicacion xmlns="urn:guardia-civil:ses:hospedajes:1">',
    `  <fecha>${escapeXml(input.businessDate)}</fecha>`,
    '  <establecimiento>',
    `    <codigo>${escapeXml(e.code)}</codigo>`,
    `    <nombre>${escapeXml(e.name)}</nombre>`,
    `    <cif>${escapeXml(e.cif)}</cif>`,
    `    <direccion>${escapeXml(e.address)}</direccion>`,
    `    <localidad>${escapeXml(e.city)}</localidad>`,
    `    <codigoPostal>${escapeXml(e.postalCode)}</codigoPostal>`,
    '  </establecimiento>',
    '  <huespedes>',
  ];
  for (const g of input.guests) {
    lines.push(
      '    <huesped>',
      `      <tipoDocumento>${escapeXml(g.documentType)}</tipoDocumento>`,
      `      <numeroDocumento>${escapeXml(g.documentNumber)}</numeroDocumento>`,
      `      <nombre>${escapeXml(g.firstName)}</nombre>`,
      `      <apellidos>${escapeXml(g.lastName)}</apellidos>`,
      `      <fechaNacimiento>${escapeXml(g.birthDate)}</fechaNacimiento>`,
      `      <nacionalidad>${escapeXml(g.nationality)}</nacionalidad>`,
      `      <fechaEntrada>${escapeXml(g.arrivalDate)}</fechaEntrada>`,
      `      <fechaSalida>${escapeXml(g.departureDate)}</fechaSalida>`,
      '    </huesped>',
    );
  }
  lines.push('  </huespedes>');
  lines.push('</comunicacion>');
  return lines.join('\n');
}
