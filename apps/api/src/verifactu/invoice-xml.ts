import type { Prisma } from '@pms/db';

/**
 * Generador del XML de `RegistroAlta` Verifactu.
 *
 * Cubre la estructura definida en RD 1007/2023 + Orden HAC/1177/2024.
 *
 * **Estado de los nombres de elementos** (cada uno marcado en el código):
 *   ✅ confirmado por texto regulatorio del RD/Orden.
 *   ⚠ por verificar contra el XSD vigente publicado por AEAT — coinciden
 *      con los nombres usados en la guía técnica pública, pero el nombre
 *      exacto puede variar entre versiones del schema. **Antes de envío
 *      real a preprod/producción, hay que validar contra el XSD activo.**
 *
 * Lo que **NO** se genera todavía:
 *  - `Desglose` por tipo de IVA por línea: por decisión del PO (ADR-032
 *    pregunta F pendiente), de momento usamos un único `DetalleDesglose`
 *    con el 10 % de alojamiento. Cuando se cubra IVA por línea en el folio,
 *    aquí se itera por grupo de tipo.
 *  - `Destinatarios` para cliente extranjero (IDOtro con código de país):
 *    MVP solo NIF español o ausencia (factura simplificada).
 *  - `Rectificativa`: bloqueado en service hasta sprint dedicado.
 *
 * Asunciones de canonicalización: salida sin saltos de línea ni indentación
 * (idéntica a la que la firma XMLDSig/XAdES re-canonicaliza), atributos sin
 * orden problemático (solo namespace), texto escapado.
 */
export interface VerifactuRegistroAltaInput {
  /** Identidad del registro. */
  invoiceId: string;

  /** Emisor (ADR-032 §5.a — un IDEmisor por tenant). */
  emisor: {
    nif: string;
    nombreRazon: string;
  };

  /** Factura. */
  series: string;
  number: number;
  /** Fecha de expedición. Se serializa en DD-MM-YYYY. */
  invoiceDate: Date;
  /** ISO 4217 (EUR). */
  currency: string;
  /** "F1" | "F2" (R1-R5 no soportados en MVP). */
  tipoFactura: string;
  /** Texto libre — "Estancia hotelera + servicios" o similar. */
  descripcionOperacion: string;

  subtotal: Prisma.Decimal | string;
  taxAmount: Prisma.Decimal | string;
  totalAmount: Prisma.Decimal | string;

  /** Cliente. NIF opcional (F2 sin NIF). */
  customerName: string;
  customerNif: string | null;
  customerAddress: string | null;

  /** Encadenamiento (ADR-032 §4). */
  huella: string;
  huellaAnterior: string | null;

  /** SistemaInformatico (ADR-032 §6) — viene de env vars. */
  sistema: {
    nombreRazon: string;
    nif: string;
    nombreSistemaInformatico: string;
    idSistemaInformatico: string;
    version: string;
    /** Único por instancia / tenant — usamos `tenantId`. */
    numeroInstalacion: string;
  };

  /** Cuándo se generó el registro. Default `new Date()`. */
  generatedAt?: Date;
}

const NS_SUMINISTRO = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeContSocio/sii/verifactu/SuministroLR.xsd';

export function buildVerifactuRegistroAlta(input: VerifactuRegistroAltaInput): string {
  const generatedAt = input.generatedAt ?? new Date();
  const numSerieFactura = `${input.series}-${input.number}`;
  const fechaExpedicion = formatDateDDMMYYYY(input.invoiceDate);
  const fechaHoraHusoGen = generatedAt.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ

  const idFactura =
    `<IDFactura>` + // ⚠ nombre exacto pendiente XSD
      `<IDEmisorFactura>` +
        `<NIF>${esc(input.emisor.nif)}</NIF>` + // ✅
        `<NombreRazon>${esc(input.emisor.nombreRazon)}</NombreRazon>` + // ✅
      `</IDEmisorFactura>` +
      `<NumSerieFactura>${esc(numSerieFactura)}</NumSerieFactura>` + // ✅
      `<FechaExpedicionFactura>${esc(fechaExpedicion)}</FechaExpedicionFactura>` + // ✅
    `</IDFactura>`;

  const destinatarios = input.customerNif
    ? // F1: cliente con NIF.
      `<Destinatarios>` + // ⚠ por verificar
        `<IDDestinatario>` +
          `<NombreRazon>${esc(input.customerName)}</NombreRazon>` +
          `<NIF>${esc(input.customerNif)}</NIF>` +
        `</IDDestinatario>` +
      `</Destinatarios>`
    : // F2: simplificada sin identificación.
      '';

  // Desglose mínimo: una sola línea con tipo IVA al 10 % (alojamiento
  // hotelero). Cuando se modele IVA por línea (ADR-032 §7 pregunta F),
  // aquí se itera.
  const desglose =
    `<Desglose>` + // ⚠ por verificar nombre
      `<DetalleDesglose>` + // ⚠
        `<ClaveRegimen>01</ClaveRegimen>` + // ⚠ Régimen general
        `<CalificacionOperacion>S1</CalificacionOperacion>` + // ⚠ Sujeta y no exenta
        `<TipoImpositivo>10.00</TipoImpositivo>` + // alojamiento
        `<BaseImponibleOimporteNoSujeto>${esc(toFixed2(input.subtotal))}</BaseImponibleOimporteNoSujeto>` +
        `<CuotaRepercutida>${esc(toFixed2(input.taxAmount))}</CuotaRepercutida>` +
      `</DetalleDesglose>` +
    `</Desglose>`;

  const encadenamiento =
    `<Encadenamiento>` + // ✅
      (input.huellaAnterior
        ? // El registro anterior se referencia por sus campos identificativos
          // + su huella. Los nombres exactos van pendientes de XSD; usamos los
          // mismos que en IDFactura por coherencia documentada.
          `<RegistroAnterior>` + // ⚠
            `<IDEmisorFactura>` +
              `<NIF>${esc(input.emisor.nif)}</NIF>` +
            `</IDEmisorFactura>` +
            `<Huella>${esc(input.huellaAnterior)}</Huella>` + // ✅
          `</RegistroAnterior>`
        : `<PrimerRegistro>S</PrimerRegistro>`) + // ✅
    `</Encadenamiento>`;

  const sistema =
    `<SistemaInformatico>` + // ✅
      `<NombreRazon>${esc(input.sistema.nombreRazon)}</NombreRazon>` +
      `<NIF>${esc(input.sistema.nif)}</NIF>` +
      `<NombreSistemaInformatico>${esc(input.sistema.nombreSistemaInformatico)}</NombreSistemaInformatico>` +
      `<IdSistemaInformatico>${esc(input.sistema.idSistemaInformatico)}</IdSistemaInformatico>` +
      `<Version>${esc(input.sistema.version)}</Version>` +
      `<NumeroInstalacion>${esc(input.sistema.numeroInstalacion)}</NumeroInstalacion>` +
    `</SistemaInformatico>`;

  // Root envoltorio. ⚠ nombre exacto del root: usar el del XSD vigente
  // antes de envío real. `IDVersion` lo solicitan algunas versiones de
  // schema; lo incluimos por seguridad.
  return (
    `<RegFactuSistemaFacturacion xmlns="${NS_SUMINISTRO}">` + // ⚠
      `<RegistroAlta>` + // ⚠
        `<IDVersion>1.0</IDVersion>` + // ⚠
        idFactura +
        `<NombreRazonEmisor>${esc(input.emisor.nombreRazon)}</NombreRazonEmisor>` + // ⚠
        `<TipoFactura>${esc(input.tipoFactura)}</TipoFactura>` + // ✅
        `<DescripcionOperacion>${esc(input.descripcionOperacion)}</DescripcionOperacion>` + // ✅
        destinatarios +
        desglose +
        `<CuotaTotal>${esc(toFixed2(input.taxAmount))}</CuotaTotal>` + // ✅
        `<ImporteTotal>${esc(toFixed2(input.totalAmount))}</ImporteTotal>` + // ✅
        encadenamiento +
        sistema +
        `<FechaHoraHusoGenRegistro>${esc(fechaHoraHusoGen)}</FechaHoraHusoGenRegistro>` + // ✅
        `<TipoHuella>01</TipoHuella>` + // ✅ "01" = SHA-256
        `<Huella>${esc(input.huella)}</Huella>` + // ✅
      `</RegistroAlta>` +
    `</RegFactuSistemaFacturacion>`
  );
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toFixed2(v: Prisma.Decimal | string): string {
  if (typeof v === 'string') return v;
  return v.toFixed(2);
}

function formatDateDDMMYYYY(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${dd}-${mm}-${yyyy}`;
}
