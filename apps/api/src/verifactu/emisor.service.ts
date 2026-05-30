import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../db';
import type { AuthUser } from '../auth';

export interface EmisorData {
  nif: string | null;
  razonSocial: string | null;
}

/**
 * Lee y escribe los datos del emisor (NIF + razón social) del Tenant.
 * Ver ADR-032 §5.a — un IDEmisor por tenant.
 *
 * El servicio NO valida formato — eso lo hace el DTO en el controller.
 * Aquí asumimos input validado.
 */
@Injectable()
export class EmisorService {
  private readonly log = new Logger(EmisorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async get(user: AuthUser, correlationId: string): Promise<EmisorData> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    const row = await this.prisma.withTenant(ctx, async (tx) => {
      return tx.tenant.findUnique({
        where: { id: user.tenantId },
        select: { nif: true, razonSocial: true },
      });
    });
    return { nif: row?.nif ?? null, razonSocial: row?.razonSocial ?? null };
  }

  async update(
    user: AuthUser,
    correlationId: string,
    data: { nif: string; razonSocial: string },
  ): Promise<EmisorData> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    const row = await this.prisma.withTenant(ctx, async (tx) => {
      return tx.tenant.update({
        where: { id: user.tenantId },
        data: { nif: data.nif, razonSocial: data.razonSocial },
        select: { nif: true, razonSocial: true },
      });
    });
    this.log.log(`Emisor updated tenant=${user.tenantId} nif=${data.nif}`);
    return row;
  }
}
