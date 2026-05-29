import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type {
  AeatClient,
  AeatSubmitRequest,
  AeatSubmitResult,
} from './aeat-client.interface';

/**
 * Cliente AEAT en modo stub (default).
 *
 * No abre red. Útil en dev, tests y CI. El CSV devuelto es determinista
 * (SHA-256 del XML, primeros 16 chars en mayúscula) — los tests pueden
 * aserlo sin fixtures.
 *
 * Para validar invariantes del módulo de envío sin necesidad de la AEAT
 * real, este stub puede simular un rechazo si el XML contiene la cadena
 * literal `<__force_reject/>` — extensible si tests más complejos lo piden.
 */
@Injectable()
export class StubAeatClient implements AeatClient {
  readonly mode = 'stub' as const;
  private readonly log = new Logger(StubAeatClient.name);

  async submit(request: AeatSubmitRequest): Promise<AeatSubmitResult> {
    this.log.debug(
      `stub.submit tenant=${request.tenantId} invoice=${request.invoiceId} bytes=${request.signedXml.length}`,
    );

    if (request.signedXml.includes('<__force_reject/>')) {
      return {
        status: 'REJECTED',
        responseCode: 422,
        responsePayload: '<error>forced by stub</error>',
        errorMessage: 'stub: forced reject',
      };
    }

    const csv = createHash('sha256')
      .update(request.signedXml)
      .digest('hex')
      .slice(0, 16)
      .toUpperCase();

    return {
      status: 'ACCEPTED',
      csv,
      responseCode: 200,
      responsePayload: `<ok><csv>${csv}</csv></ok>`,
    };
  }
}
