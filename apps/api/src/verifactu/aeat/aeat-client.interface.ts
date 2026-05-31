/**
 * Verifactu — contrato del cliente AEAT.
 *
 * Tres implementaciones (ADR-030 §3): Stub | Preprod | Production. El
 * VerifactuModule selecciona una en bootstrap según VERIFACTU_MODE y guards
 * de seguridad (no real-prod en NODE_ENV != production y viceversa).
 *
 * El cliente NO conoce nada de Prisma ni del módulo — solo recibe el XML
 * firmado y devuelve el resultado del intercambio.
 */
export interface AeatSubmitRequest {
  tenantId: string;
  invoiceId: string;
  /** XML ya firmado XAdES-BES con el certificado del tenant. */
  signedXml: string;
}

export type AeatSubmitResult =
  | {
      status: 'ACCEPTED';
      /** Código Seguro de Verificación devuelto por AEAT. */
      csv: string;
      responseCode: number;
      responsePayload: string;
    }
  | {
      status: 'REJECTED';
      responseCode: number;
      responsePayload: string;
      errorMessage: string;
    };

export const AEAT_CLIENT = Symbol('AEAT_CLIENT');

export interface AeatClient {
  /** Identificador del modo activo — para logs y health-check. */
  readonly mode: 'stub' | 'preprod' | 'production';

  submit(request: AeatSubmitRequest): Promise<AeatSubmitResult>;
}
