import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import {
  ClaimLostFoundDto,
  DisposeLostFoundDto,
  ListLostFoundQuery,
  RegisterLostFoundDto,
} from './lost-found.dto';
import { LostFoundService } from './lost-found.service';

const READ_ROLES = [
  'tenant_admin',
  'front_desk',
  'housekeeping_supervisor',
  'housekeeper',
] as const;
const REGISTER_ROLES = ['tenant_admin', 'housekeeping_supervisor', 'housekeeper'] as const;
const RESOLVE_ROLES = ['tenant_admin', 'housekeeping_supervisor', 'front_desk'] as const;

@Controller('housekeeping/lost-found')
export class LostFoundController {
  constructor(private readonly service: LostFoundService) {}

  @Get()
  @Roles(...READ_ROLES)
  async list(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = ListLostFoundQuery.parse(rawQuery);
    return this.service.list(user, correlationIdOf(req), query);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  async findOne(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.findOne(user, correlationIdOf(req), id);
  }

  @Post()
  @Roles(...REGISTER_ROLES)
  async register(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest, @Body() body: unknown) {
    const input = RegisterLostFoundDto.parse(body);
    return this.service.register(user, correlationIdOf(req), input);
  }

  @Post(':id/claim')
  @Roles(...RESOLVE_ROLES)
  async claim(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = ClaimLostFoundDto.parse(body ?? {});
    return this.service.claim(user, correlationIdOf(req), id, input);
  }

  @Post(':id/dispose')
  @Roles(...RESOLVE_ROLES)
  async dispose(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = DisposeLostFoundDto.parse(body);
    return this.service.dispose(user, correlationIdOf(req), id, input);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
