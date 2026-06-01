import { Module } from '@nestjs/common';
import { SesHospedajesAutoQueueConsumer } from './ses-hospedajes.auto-queue.consumer';
import { SesHospedajesController } from './ses-hospedajes.controller';
import { SesHospedajesService } from './ses-hospedajes.service';

@Module({
  controllers: [SesHospedajesController],
  providers: [SesHospedajesService, SesHospedajesAutoQueueConsumer],
  exports: [SesHospedajesService],
})
export class SesHospedajesModule {}
