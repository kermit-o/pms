import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient, withTenant } from '@pms/db';
import type { TenantContext, TenantPrismaClient } from '@pms/db';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }

  /**
   * Ejecuta un callback en una transaccion con app.tenant_id (y opcionalmente
   * app.actor_id, app.correlation_id) seteados como settings de sesion.
   * Las RLS policies y los triggers de audit los consumen.
   */
  withTenant<T>(ctx: TenantContext, fn: (tx: TenantPrismaClient) => Promise<T>): Promise<T> {
    return withTenant(this, ctx, fn);
  }

  /**
   * Liveness check minimo. Lo usa /readyz.
   */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
