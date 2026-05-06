import { Module } from '@nestjs/common';
import { DevicePairingsController } from './device-pairings.controller';
import { DevicePairingsService } from './device-pairings.service';
import { HskToolRouter } from './hsk-tool-router';
import { LostFoundController } from './lost-found.controller';
import { LostFoundService } from './lost-found.service';
import { HousekeepingMetrics } from './metrics';
import { HousekeepingTasksController } from './tasks.controller';
import { HousekeepingTasksService } from './tasks.service';

@Module({
  controllers: [HousekeepingTasksController, LostFoundController, DevicePairingsController],
  providers: [
    HousekeepingMetrics,
    HousekeepingTasksService,
    LostFoundService,
    DevicePairingsService,
    HskToolRouter,
  ],
  exports: [HousekeepingTasksService, LostFoundService, DevicePairingsService, HskToolRouter],
})
export class HousekeepingModule {}
