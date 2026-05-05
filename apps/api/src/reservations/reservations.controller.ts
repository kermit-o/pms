import {
  Body,
  Controller,
  Delete,
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
import {
  AssignRoomDto,
  CancelReservationDto,
  CheckInDto,
  CheckOutDto,
  CreateReservationDto,
  CreateReservationGroupDto,
  PatchReservationDto,
} from './dto';
import { ReservationsService } from './reservations.service';

const FRONT_DESK_ROLES = ['tenant_admin', 'front_desk'] as const;

/**
 * REST surface for reservations. See docs/SPRINT-2-PLAN.md §2.1.
 *
 * Validation lives in dto.ts (Zod). Route handlers parse the payload via the
 * DTO schema before delegating to the service. Bodies of service methods are
 * still skeletons — see ReservationsService.
 */
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  @Roles(...FRONT_DESK_ROLES)
  async create(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ) {
    const input = CreateReservationDto.parse(body);
    return this.reservations.create(user, correlationIdOf(req), input);
  }

  @Post('groups')
  @Roles(...FRONT_DESK_ROLES)
  async createGroup(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ) {
    const input = CreateReservationGroupDto.parse(body);
    return this.reservations.createGroup(user, correlationIdOf(req), input);
  }

  @Post('walk-in')
  @Roles(...FRONT_DESK_ROLES)
  async createWalkIn(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Body() body: unknown,
  ) {
    const input = CreateReservationDto.parse({ ...(body as object), walkIn: true });
    return this.reservations.createWalkIn(user, correlationIdOf(req), input);
  }

  @Get()
  @Roles(...FRONT_DESK_ROLES, 'night_auditor')
  async list(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() query: { from?: string; to?: string; status?: string; cursor?: string },
  ) {
    return this.reservations.list(user, correlationIdOf(req), query);
  }

  @Get(':id')
  @Roles(...FRONT_DESK_ROLES, 'night_auditor')
  async findOne(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.reservations.findOne(user, correlationIdOf(req), id);
  }

  @Patch(':id')
  @Roles(...FRONT_DESK_ROLES)
  async patch(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = PatchReservationDto.parse(body);
    return this.reservations.patch(user, correlationIdOf(req), id, input);
  }

  @Delete(':id')
  @Roles(...FRONT_DESK_ROLES)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = CancelReservationDto.parse(body);
    return this.reservations.cancel(user, correlationIdOf(req), id, input);
  }

  @Post(':id/check-in')
  @Roles(...FRONT_DESK_ROLES)
  async checkIn(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = CheckInDto.parse(body ?? {});
    return this.reservations.checkIn(user, correlationIdOf(req), id, input);
  }

  @Post(':id/check-out')
  @Roles(...FRONT_DESK_ROLES)
  async checkOut(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = CheckOutDto.parse(body ?? {});
    return this.reservations.checkOut(user, correlationIdOf(req), id, input);
  }

  @Post(':id/assign-room')
  @Roles(...FRONT_DESK_ROLES)
  async assignRoom(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = AssignRoomDto.parse(body);
    return this.reservations.assignRoom(user, correlationIdOf(req), id, input);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
