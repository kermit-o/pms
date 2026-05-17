import { Module } from '@nestjs/common';
import { DbModule } from '../db';
import { EventbusModule } from '../eventbus';
import { PaymentsModule } from '../payments';
import { PublicIbeController } from './public-ibe.controller';
import { PublicIbeService } from './public-ibe.service';
import { RateLimitGuard } from './rate-limit.guard';

@Module({
  imports: [DbModule, EventbusModule, PaymentsModule],
  controllers: [PublicIbeController],
  providers: [PublicIbeService, RateLimitGuard],
  exports: [PublicIbeService],
})
export class PublicIbeModule {}
