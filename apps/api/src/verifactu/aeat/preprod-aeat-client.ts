import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import type { AeatClient, AeatSubmitRequest, AeatSubmitResult } from './aeat-client.interface';

/**
 * Cliente AEAT contra el endpoint de **pre-producción** (Verifactu preprod).
 *
 * **Estado actual: HTTP plano, autenticación mTLS pendiente.**
 *
 * La spec AEAT exige autenticación mutual TLS con el certificado del
 * emisor (el mismo `.p12` que vive en el vault del tenant). Esto requiere:
 *
 *   1. Cargar el `.p12` del tenant vía `CertificateVaultService`
 *      (ya disponible).
 *   2. Configurar un agente undici con `dispatcher = new Agent({
 *      connect: { key, cert } })` y pasarlo a `fetch(url, { dispatcher })`.
 *   3. Inyectar `CertificateVaultService` aquí (depend. circular potencial
 *      con `VerifactuModule` — el factory ya tiene acceso, no es problema).
 *
 * La razón de NO hacer mTLS todavía: el PO aún no ha facilitado el cert
 * FNMT-RCM de pruebas + URL exacta de preprod (preguntas D y G del
 * ADR-032). Este commit deja el cliente listo para que solo falte
 * habilitar mTLS cuando esos datos lleguen — el resto (parsing de
 * respuesta, timeouts, error handling, integración con el worker) ya
 * está cubierto.
 *
 * Mientras tanto: en mode=preprod sin VERIFACTU_AEAT_ENDPOINT configurada,
 * `VerifactuModule.onModuleInit()` rechaza el bootstrap. Una vez
 * configurada, el cliente abre HTTP plano — útil para apuntar a un mock
 * o sandbox interno.
 *
 * Interpretación de respuesta (aproximación pendiente de XSD vigente,
 * AEAT publica el schema de respuesta junto al de petición):
 *  - HTTP 2xx + body contiene `<CSV>` → ACCEPTED (CSV = código devuelto).
 *  - HTTP 2xx + body contiene `<CodigoErrorRegistro>` → REJECTED.
 *  - HTTP 4xx → REJECTED (el AEAT validó y rechazó).
 *  - HTTP 5xx o error de red → throw (transitorio; el worker reintenta).
 */
@Injectable()
export class PreprodAeatClient implements AeatClient {
  readonly mode = 'preprod' as const;
  private readonly log = new Logger(PreprodAeatClient.name);

  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    const endpoint = config.get('VERIFACTU_AEAT_ENDPOINT', { infer: true });
    if (!endpoint) {
      throw new Error(
        'PreprodAeatClient: VERIFACTU_AEAT_ENDPOINT vacío. ' +
          'Rellena la URL de preprod facilitada por AEAT en el .env (ver ADR-032 §G).',
      );
    }
    this.endpoint = endpoint;
    this.timeoutMs = config.get('VERIFACTU_AEAT_TIMEOUT_MS', { infer: true });
  }

  async submit(request: AeatSubmitRequest): Promise<AeatSubmitResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          // TODO mTLS: la autenticación real va por mutual TLS con el cert
          // del emisor. Cuando se habilite, este cliente usará undici.Agent
          // con `connect: { key, cert }` cargados desde CertificateVaultService.
        },
        body: request.signedXml,
        signal: controller.signal,
      });
    } catch (err) {
      const msg = (err as Error).message;
      this.log.warn(`preprod.submit network error invoice=${request.invoiceId} err=${msg}`);
      // Throws → el SubmitWorker lo trata como transitorio (nak/retry).
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const responseBody = await response.text();
    const responseCode = response.status;

    this.log.debug(
      `preprod.submit tenant=${request.tenantId} invoice=${request.invoiceId} status=${responseCode}`,
    );

    if (responseCode >= 500) {
      // Servidor caído → transitorio. Lanzamos para que worker reintente.
      throw new Error(`AEAT returned ${responseCode}: ${truncate(responseBody, 200)}`);
    }

    if (responseCode >= 400) {
      return {
        status: 'REJECTED',
        responseCode,
        responsePayload: responseBody,
        errorMessage: extractErrorMessage(responseBody) ?? `HTTP ${responseCode}`,
      };
    }

    // 2xx — parsear cuerpo. AEAT puede responder ACCEPTED con CSV o
    // REJECTED por validación de negocio (CodigoErrorRegistro) aún con 200.
    const csv = extractCsv(responseBody);
    if (csv) {
      return {
        status: 'ACCEPTED',
        csv,
        responseCode,
        responsePayload: responseBody,
      };
    }

    return {
      status: 'REJECTED',
      responseCode,
      responsePayload: responseBody,
      errorMessage: extractErrorMessage(responseBody) ?? 'No CSV in response',
    };
  }
}

/**
 * Extrae el CSV de la respuesta AEAT. La búsqueda es por el nombre del
 * elemento que la spec define ⚠ (puede variar entre versiones de schema):
 * típicamente `CSV` o `Csv`. Buscamos ambos.
 */
function extractCsv(body: string): string | null {
  const m = body.match(/<(?:[\w-]+:)?(?:CSV|Csv)\s*>([^<]+)<\//);
  return m ? m[1]!.trim() : null;
}

/**
 * Extrae un mensaje de error legible. AEAT incluye típicamente
 * `<CodigoErrorRegistro>` + `<DescripcionErrorRegistro>` ⚠ — los buscamos
 * ambos y combinamos lo encontrado.
 */
function extractErrorMessage(body: string): string | null {
  const code = body.match(/<(?:[\w-]+:)?CodigoErrorRegistro\s*>([^<]+)<\//);
  const desc = body.match(/<(?:[\w-]+:)?DescripcionErrorRegistro\s*>([^<]+)<\//);
  if (code || desc) {
    return [code?.[1], desc?.[1]].filter(Boolean).join(' — ');
  }
  return null;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
