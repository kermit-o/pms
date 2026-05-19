import { Module } from '@nestjs/common';
import { DbModule } from '../db';
import { PublicOnboardingController } from './public-onboarding.controller';
import { PublicOnboardingService } from './public-onboarding.service';

@Module({
  imports: [DbModule],
  controllers: [PublicOnboardingController],
  providers: [PublicOnboardingService],
  exports: [PublicOnboardingService],
})
export class PublicOnboardingModule {}
