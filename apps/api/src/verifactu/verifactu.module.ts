import { Logger, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import {
  AEAT_CLIENT,
  AeatClientFactory,
  StubAeatClient,
  type AeatClient,
} from './aeat';
import { CertificateVaultService } from './certificate-vault.service';
import { EmisorService } from './emisor.service';
import { InvoiceService } from './invoice.service';
import { SignerService } from './signer.service';
import { SubmitWorker } from './submit.worker';
import { VerifactuController } from './verifactu.controller';

/**
 * Verifactu (ADR-030). Esqueleto del módulo.
 *
 * Bootstrap:
 *  1. AeatClientFactory resuelve el cliente según VERIFACTU_MODE.
 *  2. Guards de seguridad en onModuleInit — el módulo se niega a arrancar si:
 *       - NODE_ENV=production y VERIFACTU_MODE != production
 *         (no enviar facturas falsas en prod).
 *       - VERIFACTU_MODE=production y NODE_ENV != production
 *         (no apuntar a AEAT real desde dev/staging por accidente).
 *       - VERIFACTU_MODE != stub y VERIFACTU_MASTER_KEY ausente
 *         (no se pueden descifrar los .p12 sin la clave maestra).
 *
 * Sigue sin haber servicios ni controladores — esos llegan en commits
 * sucesivos (issue, submit-worker, certificate-vault).
 */
@Module({
  controllers: [VerifactuController],
  providers: [
    StubAeatClient,
    AeatClientFactory,
    {
      provide: AEAT_CLIENT,
      useFactory: (factory: AeatClientFactory): AeatClient => factory.build(),
      inject: [AeatClientFactory],
    },
    InvoiceService,
    CertificateVaultService,
    EmisorService,
    SignerService,
    SubmitWorker,
  ],
  exports: [
    AEAT_CLIENT,
    InvoiceService,
    CertificateVaultService,
    EmisorService,
    SignerService,
  ],
})
export class VerifactuModule implements OnModuleInit {
  private readonly log = new Logger(VerifactuModule.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    const mode = this.config.get('VERIFACTU_MODE', { infer: true });
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    const masterKey = this.config.get('VERIFACTU_MASTER_KEY', { infer: true });

    if (nodeEnv === 'production' && mode !== 'production') {
      throw new Error(
        `VerifactuModule: NODE_ENV=production exige VERIFACTU_MODE=production (actual: ${mode}). ` +
          `No se permiten facturas stub/preprod en producción.`,
      );
    }
    if (mode === 'production' && nodeEnv !== 'production') {
      throw new Error(
        `VerifactuModule: VERIFACTU_MODE=production requiere NODE_ENV=production (actual: ${nodeEnv}). ` +
          `Bloqueado para evitar envíos accidentales al AEAT real.`,
      );
    }
    if (mode !== 'stub' && !masterKey) {
      throw new Error(
        `VerifactuModule: VERIFACTU_MODE=${mode} requiere VERIFACTU_MASTER_KEY (≥32 chars). ` +
          `Sin ella no se pueden descifrar los certificados de tenant.`,
      );
    }
    if (mode !== 'stub') {
      const endpoint = this.config.get('VERIFACTU_AEAT_ENDPOINT', { infer: true });
      if (!endpoint) {
        throw new Error(
          `VerifactuModule: VERIFACTU_MODE=${mode} requiere VERIFACTU_AEAT_ENDPOINT. ` +
            `Rellena la URL facilitada por AEAT (ver ADR-032 §G).`,
        );
      }
    }

    this.log.log(`Verifactu boot OK — mode=${mode} nodeEnv=${nodeEnv}`);
  }
}
