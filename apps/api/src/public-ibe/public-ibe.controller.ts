import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../auth';
import {
  AvailabilityQuery,
  CancelPublicReservationDto,
  CreatePublicReservationDto,
  LookupReservationQuery,
  PublicSetupIntentDto,
  ResendConfirmationDto,
} from './public-ibe.dto';
import { PublicIbeService } from './public-ibe.service';
import { RateLimit, RateLimitGuard } from './rate-limit.guard';
import { RequireTurnstile, TurnstileGuard } from './turnstile.guard';

/**
 * Endpoints sin auth para el IBE (Online Booking Engine).
 *
 * Cada acción tiene rate limit por IP. La verificación de identidad para
 * acciones sobre una reserva existente es `code + lastName`.
 */
@Public()
@UseGuards(RateLimitGuard, TurnstileGuard)
@Controller('public/ibe')
export class PublicIbeController {
  constructor(private readonly service: PublicIbeService) {}

  @Get('properties/:slug')
  @RateLimit({ max: 60, windowMs: 60_000 })
  async property(@Param('slug') slug: string) {
    return this.service.getProperty(slug);
  }

  @Get('properties/:slug/availability')
  @RateLimit({ max: 30, windowMs: 60_000 })
  async availability(
    @Param('slug') slug: string,
    @Query() raw: Record<string, string | undefined>,
  ) {
    const query = AvailabilityQuery.parse(raw);
    return this.service.searchAvailability(slug, query);
  }

  @Post('properties/:slug/reservations')
  @RateLimit({ max: 5, windowMs: 60 * 60_000 })
  @RequireTurnstile()
  async createReservation(@Param('slug') slug: string, @Body() body: unknown) {
    const input = CreatePublicReservationDto.parse(body);
    return this.service.createReservation(slug, input);
  }

  @Get('properties/:slug/reservations/:code')
  @RateLimit({ max: 20, windowMs: 60_000 })
  async reservation(
    @Param('slug') slug: string,
    @Param('code') code: string,
    @Query() raw: Record<string, string | undefined>,
  ) {
    const query = LookupReservationQuery.parse(raw);
    return this.service.getReservation(slug, code, query.lastName);
  }

  @Post('properties/:slug/reservations/:code/cancel')
  @RateLimit({ max: 5, windowMs: 60 * 60_000 })
  @RequireTurnstile()
  async cancel(
    @Param('slug') slug: string,
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    const input = CancelPublicReservationDto.parse(body);
    return this.service.cancelReservation(slug, code, input);
  }

  @Post('properties/:slug/reservations/:code/setup-intent')
  @RateLimit({ max: 10, windowMs: 60_000 })
  async setupIntent(
    @Param('slug') slug: string,
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    const input = PublicSetupIntentDto.parse(body);
    return this.service.createSetupIntent(slug, code, input.lastName);
  }

  @Post('properties/:slug/reservations/:code/confirm-setup-intent')
  @RateLimit({ max: 10, windowMs: 60_000 })
  async confirmSetupIntent(
    @Param('slug') slug: string,
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    const input = PublicSetupIntentDto.parse(body);
    return this.service.confirmSetupIntent(slug, code, input.lastName);
  }

  @Post('properties/:slug/reservations/:code/resend-confirmation')
  @RateLimit({ max: 3, windowMs: 60 * 60_000 })
  @RequireTurnstile()
  async resendConfirmation(
    @Param('slug') slug: string,
    @Param('code') code: string,
    @Body() body: unknown,
  ) {
    const input = ResendConfirmationDto.parse(body);
    return this.service.resendConfirmation(slug, code, input.lastName);
  }
}
