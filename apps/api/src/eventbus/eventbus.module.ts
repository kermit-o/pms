import { Global, Module } from '@nestjs/common';
import { EventbusService } from './eventbus.service';

@Global()
@Module({
  providers: [EventbusService],
  exports: [EventbusService],
})
export class EventbusModule {}
