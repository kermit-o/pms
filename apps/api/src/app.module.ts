import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './common/logger/logger.module';
import { DbModule } from './db';
import { AuthModule } from './auth';
import { EventbusModule } from './eventbus';
import { HealthModule } from './health/health.module';
import { MeModule } from './me/me.module';
import { PropertiesModule } from './properties/properties.module';

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
  ],
})
export class AppModule {}
