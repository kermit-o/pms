import { Global, Module } from '@nestjs/common';
import { DbModule } from '../db';
import { EmailSuppressionsService } from './email-suppressions.service';
import { NotificationsService } from './notifications.service';
import { PostmarkWebhookController } from './postmark-webhook.controller';

/**
 * Global module — el service no tiene dependencias del dominio, solo
 * lee config + plantillas + Postmark/dry-run. Marcarlo @Global evita
 * importar NotificationsModule en cada feature module que mande mails.
 *
 * Sprint 11 W1: añade `EmailSuppressionsService` (suppression list global)
 * y el webhook receiver de Postmark (`PostmarkWebhookController`).
 */
@Global()
@Module({
  imports: [DbModule],
  controllers: [PostmarkWebhookController],
  providers: [NotificationsService, EmailSuppressionsService],
  exports: [NotificationsService, EmailSuppressionsService],
})
export class NotificationsModule {}

export { NotificationsService } from './notifications.service';
export type { SendEmailInput, EmailProvider } from './notifications.service';
export { EmailSuppressionsService } from './email-suppressions.service';
