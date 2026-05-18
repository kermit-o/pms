import { Module } from '@nestjs/common';
import { DbModule } from '../db';
import { EventbusModule } from '../eventbus';
import { PaymentsModule } from '../payments';
import { PublicIbeController } from './public-ibe.controller';
import { PublicIbeMetrics } from './public-ibe.metrics';
import { PublicIbeService } from './public-ibe.service';
import { RateLimitGuard } from './rate-limit.guard';
import { TurnstileGuard } from './turnstile.guard';
import { TurnstileService } from './turnstile.service';

@Module({
  imports: [DbModule, EventbusModule, PaymentsModule],
  controllers: [PublicIbeController],
  providers: [
    PublicIbeService,
    PublicIbeMetrics,
    RateLimitGuard,
    TurnstileService,
    TurnstileGuard,
  ],
  exports: [PublicIbeService],
})
export class PublicIbeModule {}
