import { Global, Module } from '@nestjs/common';
import { DbModule } from '../db';
import { EventbusModule } from '../eventbus';
import { ChannelManagerWebhookController } from './channel-manager.controller';
import { ChannelManagerMetrics } from './channel-manager.metrics';
import { ChannelManagerService } from './channel-manager.service';
import { SiteMinderProvider } from './providers/siteminder.provider';

/**
 * @Global() — `ChannelManagerService` se invoca desde reservations e IBE
 * para el push delta on-change, y desde night-audit para el nightly. Evita
 * tener que importar el módulo en cada feature module que lo usa.
 */
@Global()
@Module({
  imports: [DbModule, EventbusModule],
  controllers: [ChannelManagerWebhookController],
  providers: [ChannelManagerService, ChannelManagerMetrics, SiteMinderProvider],
  exports: [ChannelManagerService],
})
export class ChannelManagerModule {}

export { ChannelManagerService } from './channel-manager.service';
