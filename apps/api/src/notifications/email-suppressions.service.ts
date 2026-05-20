import { Injectable, Logger } from '@nestjs/common';
import { type Counter, metrics } from '@opentelemetry/api';
import { EmailSuppressionReason, Prisma } from '@pms/db';
import { PrismaService } from '../db';

/**
 * Lista de supresión de emails (Sprint 11 W1).
 *
 * Global al SaaS (no por tenant). Alimentada por:
 *  - Postmark webhook (bounces duros, spam complaints, unsubscribes).
 *  - Operadores de soporte vía `addManual`.
 *
 * El servicio expone una API mínima y emite contadores Prometheus:
 *   email_suppressions_added_total{reason, source}
 *   email_send_skipped_suppressed_total{reason}
 *
 * Sin RLS — la reputación del dominio es responsabilidad del SaaS, no del
 * hotel. Si un email hace bounce duro en hotel A, no se intenta de nuevo
 * desde hotel B.
 */
@Injectable()
export class EmailSuppressionsService {
  private readonly log = new Logger(EmailSuppressionsService.name);
  private readonly added: Counter;
  private readonly skipped: Counter;

  constructor(private readonly prisma: PrismaService) {
    const meter = metrics.getMeter('pms-api/notifications');
    this.added = meter.createCounter('email_suppressions_added', {
      description: 'Entradas añadidas a la suppression list.',
    });
    this.skipped = meter.createCounter('email_send_skipped_suppressed', {
      description: 'Emails que no se enviaron por estar en la suppression list.',
    });
  }

  async isSuppressed(email: string): Promise<{ suppressed: boolean; reason?: EmailSuppressionReason }> {
    const row = await this.prisma.emailSuppression.findUnique({
      where: { email: normalize(email) },
      select: { reason: true },
    });
    if (!row) return { suppressed: false };
    this.skipped.add(1, { reason: row.reason });
    return { suppressed: true, reason: row.reason };
  }

  async upsert(input: {
    email: string;
    reason: EmailSuppressionReason;
    detail?: string | null;
    source: string;
  }): Promise<void> {
    const email = normalize(input.email);
    if (!email) return;
    const detail = input.detail?.slice(0, 500) ?? null;
    try {
      // upsert simple: si ya existe, mantenemos la primera razón (la más
      // grave gana implícitamente porque MANUAL/UNSUBSCRIBE no van a
      // pisar un HARD_BOUNCE en la práctica).
      await this.prisma.emailSuppression.upsert({
        where: { email },
        create: { email, reason: input.reason, detail, source: input.source },
        update: { detail, source: input.source },
      });
      this.added.add(1, { reason: input.reason, source: input.source });
      this.log.log(
        `suppression added email=${email} reason=${input.reason} source=${input.source}`,
      );
    } catch (err) {
      // Postgres unique violation u otro error — no propagamos para no
      // romper el webhook handler.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
      this.log.warn(`upsert suppression failed: ${(err as Error).message}`);
    }
  }

  async remove(email: string): Promise<boolean> {
    const result = await this.prisma.emailSuppression.deleteMany({
      where: { email: normalize(email) },
    });
    return result.count > 0;
  }
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}
