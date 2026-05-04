import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('healthz')
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('readyz')
  readiness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
