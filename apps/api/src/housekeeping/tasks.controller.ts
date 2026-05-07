import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import {
  CancelTaskDto,
  CompleteTaskDto,
  CreateTaskDto,
  ListTasksQuery,
  ReassignTaskDto,
  SuggestAssignmentsQuery,
  SummaryQuery,
} from './dto';
import { HousekeepingTasksService } from './tasks.service';

const READ_ROLES = [
  'tenant_admin',
  'front_desk',
  'night_auditor',
  'housekeeping_supervisor',
  'housekeeper',
] as const;
const WRITE_ROLES = ['tenant_admin', 'housekeeping_supervisor', 'housekeeper'] as const;

@Controller('housekeeping/tasks')
export class HousekeepingTasksController {
  constructor(private readonly tasks: HousekeepingTasksService) {}

  @Get()
  @Roles(...READ_ROLES)
  async list(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = ListTasksQuery.parse(rawQuery);
    return this.tasks.list(user, correlationIdOf(req), query);
  }

  @Get('summary')
  @Roles('tenant_admin', 'housekeeping_supervisor')
  async summary(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = SummaryQuery.parse(rawQuery);
    return this.tasks.summary(user, correlationIdOf(req), query);
  }

  @Get('suggestions')
  @Roles('tenant_admin', 'housekeeping_supervisor')
  async suggestions(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = SuggestAssignmentsQuery.parse(rawQuery);
    return this.tasks.suggestAssignments(user, correlationIdOf(req), query);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  async findOne(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.tasks.findOne(user, correlationIdOf(req), id);
  }

  @Post()
  @Roles('tenant_admin', 'housekeeping_supervisor')
  async create(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest, @Body() body: unknown) {
    const input = CreateTaskDto.parse(body);
    return this.tasks.create(user, correlationIdOf(req), input);
  }

  @Post(':id/start')
  @Roles(...WRITE_ROLES)
  async start(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.tasks.start(user, correlationIdOf(req), id);
  }

  @Post(':id/complete')
  @Roles(...WRITE_ROLES)
  async complete(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = CompleteTaskDto.parse(body ?? {});
    return this.tasks.complete(user, correlationIdOf(req), id, input);
  }

  @Post(':id/reassign')
  @Roles('tenant_admin', 'housekeeping_supervisor')
  async reassign(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = ReassignTaskDto.parse(body);
    return this.tasks.reassign(user, correlationIdOf(req), id, input);
  }

  @Post(':id/cancel')
  @Roles('tenant_admin', 'housekeeping_supervisor')
  async cancel(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = CancelTaskDto.parse(body);
    return this.tasks.cancel(user, correlationIdOf(req), id, input);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
