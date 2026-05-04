import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './common/logger/logger.module';
import { DbModule } from './db';
import { HealthModule } from './health/health.module';

@Module({
  imports: [ConfigModule, LoggerModule, DbModule, HealthModule],
})
export class AppModule {}
