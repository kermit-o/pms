import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import type { AeatClient } from './aeat-client.interface';
import { StubAeatClient } from './stub-aeat-client';

/**
 * Resuelve qué AeatClient inyectar al módulo según VERIFACTU_MODE.
 *
 * Por ahora (esqueleto), solo el StubAeatClient está disponible. Los modos
 * `preprod` y `production` reservan el slot y rechazan con un error claro
 * — la implementación real llegará en commits sucesivos junto con la firma
 * XAdES y el cliente HTTP contra AEAT.
 *
 * Los guards de seguridad (no production fuera de NODE_ENV=production, no
 * stub en production) viven en VerifactuModule.onModuleInit, no aquí.
 */
@Injectable()
export class AeatClientFactory {
  private readonly log = new Logger(AeatClientFactory.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly stub: StubAeatClient,
  ) {}

  build(): AeatClient {
    const mode = this.config.get('VERIFACTU_MODE', { infer: true });

    if (mode === 'stub') {
      this.log.log('AEAT client: stub (no network)');
      return this.stub;
    }

    throw new Error(
      `VERIFACTU_MODE=${mode} no implementado todavía. ` +
        `Solo 'stub' está disponible en este esqueleto (ver ADR-030).`,
    );
  }
}
