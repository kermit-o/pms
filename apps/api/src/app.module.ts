import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './common/logger/logger.module';
import { DbModule } from './db';
import { AuthModule } from './auth';
import { EventbusModule } from './eventbus';
import { HealthModule } from './health/health.module';
import { MeModule } from './me/me.module';
import { PropertiesModule } from './properties/properties.module';
import { ReservationsModule } from './reservations';
import { FolioModule } from './folio';
import { GuestsModule } from './guests';
import { RoomsModule } from './rooms';
import { BusinessDayModule } from './business-day';
import { SesHospedajesModule } from './compliance/ses-hospedajes';
import { CashModule } from './cash';
import { CopilotModule } from './copilot';
import { HousekeepingModule } from './housekeeping';
import { NightAuditModule } from './night-audit';
import { NotificationsModule } from './notifications';
import { PaymentsModule } from './payments';
import { PublicIbeModule } from './public-ibe';
import { PublicOnboardingModule } from './public-onboarding';
import { ReportsModule } from './reports';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DbModule,
    EventbusModule,
    AuthModule,
    HealthModule,
    MeModule,
    PropertiesModule,
    ReservationsModule,
    FolioModule,
    GuestsModule,
    RoomsModule,
    BusinessDayModule,
    SesHospedajesModule,
    CopilotModule,
    NightAuditModule,
    NotificationsModule,
    PaymentsModule,
    PublicIbeModule,
    PublicOnboardingModule,
    ReportsModule,
    CashModule,
    HousekeepingModule,
  ],
})
export class AppModule {}
