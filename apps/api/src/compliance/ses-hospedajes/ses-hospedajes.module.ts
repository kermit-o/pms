import { Module } from '@nestjs/common';
import { SesHospedajesController } from './ses-hospedajes.controller';
import { SesHospedajesService } from './ses-hospedajes.service';

@Module({
  controllers: [SesHospedajesController],
  providers: [SesHospedajesService],
  exports: [SesHospedajesService],
})
export class SesHospedajesModule {}
