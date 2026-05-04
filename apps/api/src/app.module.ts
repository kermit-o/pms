import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './common/logger/logger.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [ConfigModule, LoggerModule, HealthModule],
})
export class AppModule {}
