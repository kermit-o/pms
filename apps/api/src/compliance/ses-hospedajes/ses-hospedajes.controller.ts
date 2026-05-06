import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../../auth';
import type { AuthUser } from '../../auth';
import { ListSubmissionsQuery, QueueSubmissionDto } from './dto';
import { SesHospedajesService } from './ses-hospedajes.service';

const ROLES_READ = ['tenant_admin', 'front_desk', 'night_auditor'] as const;
const ROLES_WRITE = ['tenant_admin', 'night_auditor'] as const;

@Controller('compliance/ses-hospedajes/submissions')
export class SesHospedajesController {
  constructor(private readonly service: SesHospedajesService) {}

  @Get()
  @Roles(...ROLES_READ)
  async list(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Query() rawQuery: Record<string, string | undefined>,
  ) {
    const query = ListSubmissionsQuery.parse(rawQuery);
    return this.service.list(user, correlationIdOf(req), query);
  }

  @Get(':id')
  @Roles(...ROLES_READ)
  async findOne(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.findOne(user, correlationIdOf(req), id);
  }

  @Post()
  @Roles(...ROLES_WRITE)
  async queue(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest, @Body() body: unknown) {
    const input = QueueSubmissionDto.parse(body);
    return this.service.queue(user, correlationIdOf(req), input);
  }

  @Post(':id/send')
  @Roles(...ROLES_WRITE)
  async send(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.send(user, correlationIdOf(req), id);
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
