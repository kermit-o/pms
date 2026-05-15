import { Module } from '@nestjs/common';
import { DbModule } from '../db';
import { AuthModule } from '../auth';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';

@Module({
  imports: [DbModule, AuthModule],
  providers: [StripeService],
  controllers: [StripeController],
  exports: [StripeService],
})
export class PaymentsModule {}
