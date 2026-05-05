import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';

type CheckStatus = 'ok' | 'fail';

@Public()
@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventbus: EventbusService,
  ) {}

  @Get('healthz')
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('readyz')
  async readiness() {
    const checks: Record<string, CheckStatus> = { db: 'fail', nats: 'fail' };

    try {
      await this.prisma.ping();
      checks.db = 'ok';
    } catch (err) {
      this.logger.error({ err }, 'readiness DB check failed');
    }

    try {
      this.eventbus.ping();
      checks.nats = 'ok';
    } catch (err) {
      this.logger.error({ err }, 'readiness NATS check failed');
    }

    const ready = Object.values(checks).every((s) => s === 'ok');
    const body = {
      status: ready ? 'ok' : 'fail',
      checks,
      timestamp: new Date().toISOString(),
    };
    if (!ready) {
      throw new ServiceUnavailableException(body);
    }
    return body;
  }
}
