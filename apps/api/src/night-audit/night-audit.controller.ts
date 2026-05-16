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
import {
  ListAnomaliesQuery,
  ListRunsQuery,
  ReviewAnomalyDto,
  RunNightAuditDto,
  StateQuery,
} from './dto';
import { NightAuditService } from './night-audit.service';

const READ_ROLES = ['tenant_admin', 'front_desk', 'night_auditor'] as const;
const WRITE_ROLES = ['tenant_admin', 'night_auditor'] as const;

@Controller('night-audit')
export class NightAuditController {
  constructor(private readonly service: NightAuditService) {}

  @Post('run')
  @Roles(...WRITE_ROLES)
  async run(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest, @Body() body: unknown) {
    const input = RunNightAuditDto.parse(body);
    return this.service.run(user, correlationIdOf(req), input);
  }

  @Post('runs/:id/resume')
  @Roles(...WRITE_ROLES)
  async resume(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.resume(user, correlationIdOf(req), id);
  }

  @Get('runs')
  @Roles(...READ_ROLES)
  async list(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = ListRunsQuery.parse(rawQuery);
    return this.service.list(user, correlationIdOf(req), query);
  }

  @Get('runs/:id')
  @Roles(...READ_ROLES)
  async findOne(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.findOne(user, correlationIdOf(req), id);
  }

  @Get('anomalies')
  @Roles(...READ_ROLES)
  async listAnomalies(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = ListAnomaliesQuery.parse(rawQuery);
    return this.service.listAnomalies(user, correlationIdOf(req), query);
  }

  @Patch('anomalies/:id/review')
  @Roles(...WRITE_ROLES)
  async reviewAnomaly(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = ReviewAnomalyDto.parse(body ?? {});
    return this.service.reviewAnomaly(user, correlationIdOf(req), id, input.notes);
  }

  @Get('state')
  @Roles(...READ_ROLES)
  async state(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = StateQuery.parse(rawQuery);
    return this.service.getState(user, correlationIdOf(req), query.propertyId, query.businessDate);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
