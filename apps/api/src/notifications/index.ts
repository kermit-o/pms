import { Global, Module } from '@nestjs/common';
import { DbModule } from '../db';
import { EmailSuppressionsService } from './email-suppressions.service';
import { NotificationsConsumer } from './notifications.consumer';
import { NotificationsService } from './notifications.service';
import { PostmarkWebhookController } from './postmark-webhook.controller';

/**
 * Global module — el service no tiene dependencias del dominio, solo
 * lee config + plantillas + Postmark/dry-run. Marcarlo @Global evita
 * importar NotificationsModule en cada feature module que mande mails.
 *
 * Sprint 11 W1: añade `EmailSuppressionsService` + webhook receiver de
 *               Postmark.
 * Sprint 11 W2: añade `NotificationsConsumer` (NATS) + `enqueueEmail`
 *               en el service (publish + fallback inline).
 */
@Global()
@Module({
  imports: [DbModule],
  controllers: [PostmarkWebhookController],
  providers: [NotificationsService, EmailSuppressionsService, NotificationsConsumer],
  exports: [NotificationsService, EmailSuppressionsService],
})
export class NotificationsModule {}

export { NotificationsService } from './notifications.service';
export type {
  SendEmailInput,
  EmailProvider,
  EnqueueEmailInput,
  EnqueueResult,
} from './notifications.service';
export { EmailSuppressionsService } from './email-suppressions.service';
export { NotificationsConsumer } from './notifications.consumer';
