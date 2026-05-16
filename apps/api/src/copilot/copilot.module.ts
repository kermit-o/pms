import { Module } from '@nestjs/common';
import { DbModule } from '../db';
import { FolioModule } from '../folio';
import { HousekeepingModule } from '../housekeeping';
import { NightAuditModule } from '../night-audit';
import { ReportsModule } from '../reports';
import { ReservationsModule } from '../reservations';
import { RoomsModule } from '../rooms';
import { AdapterFactory, COPILOT_ADAPTER } from './adapter-factory';
import { AnthropicAdapter } from './anthropic-adapter';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { MemoryService } from './memory/memory.service';
import { CopilotMetrics } from './metrics';
import { StubAdapter } from './stub-adapter';
import { ToolResolver } from './tool-resolver';
import { FoToolRouter } from './tool-router';

@Module({
  imports: [
    DbModule,
    ReservationsModule,
    RoomsModule,
    FolioModule,
    ReportsModule,
    HousekeepingModule,
    NightAuditModule,
  ],
  controllers: [CopilotController],
  providers: [
    CopilotService,
    CopilotMetrics,
    MemoryService,
    FoToolRouter,
    ToolResolver,
    StubAdapter,
    AnthropicAdapter,
    AdapterFactory,
    {
      provide: COPILOT_ADAPTER,
      inject: [AdapterFactory],
      useFactory: (f: AdapterFactory) => f.build(),
    },
  ],
  exports: [CopilotService, FoToolRouter, ToolResolver],
})
export class CopilotModule {}
