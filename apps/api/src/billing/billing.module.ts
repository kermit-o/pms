import { Module } from '@nestjs/common';
import { DbModule } from '../db';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [DbModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
