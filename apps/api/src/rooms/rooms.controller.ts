import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import {
  AvailabilityQuery,
  ChangeStatusDto,
  ListRoomsQuery,
  SearchAvailabilityQuery,
} from './dto';
import { RoomsService } from './rooms.service';

const READ_ROLES = [
  'tenant_admin',
  'front_desk',
  'night_auditor',
  'housekeeping_supervisor',
  'housekeeper',
] as const;

@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  @Roles(...READ_ROLES)
  async list(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = ListRoomsQuery.parse(rawQuery);
    return this.rooms.list(user, correlationIdOf(req), query);
  }

  @Get('availability')
  @Roles(...READ_ROLES)
  async availability(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = AvailabilityQuery.parse(rawQuery);
    return this.rooms.availability(user, correlationIdOf(req), query);
  }

  @Get('availability/search')
  @Roles(...READ_ROLES)
  async searchAvailability(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = SearchAvailabilityQuery.parse(rawQuery);
    return this.rooms.searchAvailability(user, correlationIdOf(req), query);
  }

  @Post(':id/status')
  @Roles('tenant_admin', 'front_desk', 'housekeeping_supervisor', 'housekeeper')
  async changeStatus(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = ChangeStatusDto.parse(body);
    return this.rooms.changeStatus(user, correlationIdOf(req), id, input);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
