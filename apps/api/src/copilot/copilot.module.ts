import { Module } from '@nestjs/common';
import { FolioModule } from '../folio';
import { ReservationsModule } from '../reservations';
import { RoomsModule } from '../rooms';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { FoToolRouter } from './tool-router';

@Module({
  imports: [ReservationsModule, RoomsModule, FolioModule],
  controllers: [CopilotController],
  providers: [CopilotService, FoToolRouter],
  exports: [CopilotService, FoToolRouter],
})
export class CopilotModule {}
