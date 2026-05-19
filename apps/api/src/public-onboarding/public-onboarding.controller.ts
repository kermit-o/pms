import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../auth';
import {
  SetupOnboardingDto,
  StartOnboardingDto,
  VerifyOnboardingDto,
} from './public-onboarding.dto';
import { PublicOnboardingService } from './public-onboarding.service';

/**
 * Endpoints públicos del wizard de onboarding (Sprint 9 W3).
 *
 * Sin auth — el wizard se completa sin sesión. El rate-limit se aplica a
 * nivel de proxy del web-fo (server actions) + Postmark/Turnstile cuando
 * se configure. Tokens HMAC firmados con `ONBOARDING_SECRET`.
 */
@Public()
@Controller('public/onboarding')
export class PublicOnboardingController {
  constructor(private readonly service: PublicOnboardingService) {}

  @Post('start')
  async start(@Body() body: unknown) {
    const input = StartOnboardingDto.parse(body);
    return this.service.start(input);
  }

  @Post('verify')
  async verify(@Body() body: unknown) {
    const input = VerifyOnboardingDto.parse(body);
    return this.service.verify(input.token);
  }

  @Post('setup')
  async setup(@Body() body: unknown) {
    const input = SetupOnboardingDto.parse(body);
    return this.service.setup(input);
  }
}
