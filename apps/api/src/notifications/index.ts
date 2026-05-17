import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

/**
 * Global module — el service no tiene dependencias del dominio, solo
 * lee config + plantillas + Postmark/dry-run. Marcarlo @Global evita
 * importar NotificationsModule en cada feature module que mande mails.
 */
@Global()
@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

export { NotificationsService } from './notifications.service';
export type { SendEmailInput, EmailProvider } from './notifications.service';
