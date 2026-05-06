import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import { CreateGuestDto, EraseGuestDto, ListGuestsQuery, PatchGuestDto } from './dto';
import { GuestsService } from './guests.service';

const FRONT_DESK_ROLES = ['tenant_admin', 'front_desk'] as const;
const READ_ROLES = [...FRONT_DESK_ROLES, 'night_auditor'] as const;

@Controller('guests')
export class GuestsController {
  constructor(private readonly guests: GuestsService) {}

  @Get()
  @Roles(...READ_ROLES)
  async list(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = ListGuestsQuery.parse(rawQuery);
    return this.guests.list(user, correlationIdOf(req), query);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  async findOne(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.guests.findOne(user, correlationIdOf(req), id);
  }

  @Post()
  @Roles(...FRONT_DESK_ROLES)
  async create(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest, @Body() body: unknown) {
    const input = CreateGuestDto.parse(body);
    return this.guests.create(user, correlationIdOf(req), input);
  }

  @Patch(':id')
  @Roles(...FRONT_DESK_ROLES)
  async patch(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = PatchGuestDto.parse(body);
    return this.guests.patch(user, correlationIdOf(req), id, input);
  }

  @Get(':id/access-export')
  @Roles(...FRONT_DESK_ROLES)
  async accessExport(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.guests.accessExport(user, correlationIdOf(req), id);
  }

  @Post(':id/erase')
  @Roles(...FRONT_DESK_ROLES)
  async erase(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = EraseGuestDto.parse(body);
    return this.guests.erase(user, correlationIdOf(req), id, input);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
