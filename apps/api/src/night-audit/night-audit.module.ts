import { Module } from '@nestjs/common';
import { AnomalyMetrics } from './anomaly.metrics';
import { AnomalyService } from './anomaly.service';
import { NightAuditController } from './night-audit.controller';
import { NightAuditService } from './night-audit.service';

@Module({
  controllers: [NightAuditController],
  providers: [NightAuditService, AnomalyService, AnomalyMetrics],
  exports: [NightAuditService, AnomalyService],
})
export class NightAuditModule {}
