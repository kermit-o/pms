import { Module } from '@nestjs/common';
import { FolioModule } from '../folio';
import { HousekeepingModule } from '../housekeeping';
import { ReportsModule } from '../reports';
import { ReservationsModule } from '../reservations';
import { RoomsModule } from '../rooms';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { ToolResolver } from './tool-resolver';
import { FoToolRouter } from './tool-router';

@Module({
  imports: [ReservationsModule, RoomsModule, FolioModule, ReportsModule, HousekeepingModule],
  controllers: [CopilotController],
  providers: [CopilotService, FoToolRouter, ToolResolver],
  exports: [CopilotService, FoToolRouter, ToolResolver],
})
export class CopilotModule {}
