import { Module } from '@nestjs/common';
import { DbModule } from '../db';
import { EventbusModule } from '../eventbus';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';

@Module({
  imports: [DbModule, EventbusModule],
  controllers: [PropertiesController],
  providers: [PropertiesService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
