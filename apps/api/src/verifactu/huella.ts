import { createHash } from 'node:crypto';

/**
 * Cálculo de la huella SHA-256 que encadena los registros de factura
 * (art. 8 RD 1007/2023, ver ADR-032 §4).
 *
 * La fórmula concatena el hash del registro anterior con los campos
 * identificativos del registro actual y aplica SHA-256. El primer registro
 * del emisor usa `prev = null` (PrimerRegistro).
 *
 * **Formato canónico de entrada** (cada par `clave=valor` separado por `&`,
 * en orden estable, sin escapes URL — aproximación lo más cercana posible
 * a la fórmula publicada por AEAT). El orden y los nombres exactos están
 * pendientes de validar contra la guía técnica vigente — marcado en JSDoc
 * para que se verifique antes de enviar a producción.
 */
export interface HuellaInput {
  /** NIF del emisor (Tenant.nif), sin espacios. */
  emisorNif: string;
  /** Número de serie + número, e.g. "A-43". */
  numSerieFactura: string;
  /** Fecha de expedición en formato DD-MM-YYYY (AEAT español). */
  fechaExpedicionFactura: string;
  /** Tipo factura: "F1" | "F2" (o "R1"-"R5" en el futuro). */
  tipoFactura: string;
  /** Cuota total IVA (string con 2 decimales, e.g. "10.00"). */
  cuotaTotal: string;
  /** Importe total factura (string con 2 decimales, e.g. "110.00"). */
  importeTotal: string;
}

export function computeHuella(input: HuellaInput, previousHuella: string | null): string {
  const body =
    `IDEmisorFactura=${input.emisorNif}` +
    `&NumSerieFactura=${input.numSerieFactura}` +
    `&FechaExpedicionFactura=${input.fechaExpedicionFactura}` +
    `&TipoFactura=${input.tipoFactura}` +
    `&CuotaTotal=${input.cuotaTotal}` +
    `&ImporteTotal=${input.importeTotal}` +
    `&Huella=${previousHuella ?? ''}`;
  return createHash('sha256').update(body, 'utf-8').digest('hex');
}

/** Formatea una fecha como DD-MM-YYYY (formato AEAT). */
export function formatFechaExpedicion(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${dd}-${mm}-${yyyy}`;
}
