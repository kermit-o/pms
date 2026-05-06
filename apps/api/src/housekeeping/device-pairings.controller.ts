import { Body, Controller, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Public, Roles } from '../auth';
import type { AuthUser } from '../auth';
import { MintPairingDto, RedeemPairingDto } from './device-pairings.dto';
import { DevicePairingsService } from './device-pairings.service';

@Controller('housekeeping/pairings')
export class DevicePairingsController {
  constructor(private readonly service: DevicePairingsService) {}

  @Post()
  @Roles('tenant_admin', 'housekeeping_supervisor')
  async mint(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ) {
    const input = MintPairingDto.parse(body);
    return this.service.mint(user, correlationIdOf(req), input);
  }

  @Post('redeem')
  @Public()
  async redeem(@Req() req: FastifyRequest, @Body() body: unknown) {
    const input = RedeemPairingDto.parse(body);
    return this.service.redeem(correlationIdOf(req), input);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
