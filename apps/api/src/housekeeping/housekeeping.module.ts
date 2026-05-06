import { Module } from '@nestjs/common';
import { LostFoundController } from './lost-found.controller';
import { LostFoundService } from './lost-found.service';
import { HousekeepingTasksController } from './tasks.controller';
import { HousekeepingTasksService } from './tasks.service';

@Module({
  controllers: [HousekeepingTasksController, LostFoundController],
  providers: [HousekeepingTasksService, LostFoundService],
  exports: [HousekeepingTasksService, LostFoundService],
})
export class HousekeepingModule {}
