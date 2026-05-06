import { Module } from '@nestjs/common';
import { HousekeepingTasksController } from './tasks.controller';
import { HousekeepingTasksService } from './tasks.service';

@Module({
  controllers: [HousekeepingTasksController],
  providers: [HousekeepingTasksService],
  exports: [HousekeepingTasksService],
})
export class HousekeepingModule {}
