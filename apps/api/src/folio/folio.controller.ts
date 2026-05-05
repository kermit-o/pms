import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import { AddChargeDto, AddPaymentDto, ReopenFolioDto } from './dto';
import { FolioService } from './folio.service';

const FRONT_DESK_ROLES = ['tenant_admin', 'front_desk'] as const;
const READ_ROLES = [...FRONT_DESK_ROLES, 'night_auditor'] as const;

@Controller('folios')
export class FolioController {
  constructor(private readonly folio: FolioService) {}

  @Get(':id')
  @Roles(...READ_ROLES)
  async findOne(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.folio.findOne(user, correlationIdOf(req), id);
  }

  @Post(':id/charges')
  @Roles(...FRONT_DESK_ROLES)
  async addCharge(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = AddChargeDto.parse(body);
    return this.folio.addCharge(user, correlationIdOf(req), id, input);
  }

  @Post(':id/payments')
  @Roles(...FRONT_DESK_ROLES)
  async addPayment(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = AddPaymentDto.parse(body);
    return this.folio.addPayment(user, correlationIdOf(req), id, input);
  }

  @Post(':id/close')
  @Roles(...FRONT_DESK_ROLES, 'night_auditor')
  async close(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.folio.close(user, correlationIdOf(req), id);
  }

  @Post(':id/reopen')
  @Roles('tenant_admin', 'night_auditor')
  async reopen(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = ReopenFolioDto.parse(body);
    return this.folio.reopen(user, correlationIdOf(req), id, input);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
