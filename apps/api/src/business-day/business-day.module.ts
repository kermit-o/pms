import { Module } from '@nestjs/common';
import { BusinessDayController } from './business-day.controller';
import { BusinessDayService } from './business-day.service';

@Module({
  controllers: [BusinessDayController],
  providers: [BusinessDayService],
  exports: [BusinessDayService],
})
export class BusinessDayModule {}
