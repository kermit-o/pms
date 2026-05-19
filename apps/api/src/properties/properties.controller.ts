import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import { PrismaService } from '../db';
import {
  BlockedIpsDto,
  ChannelManagerConfigDto,
  PublishPropertyDto,
} from './properties.dto';
import { PropertiesService } from './properties.service';

@Controller('properties')
export class PropertiesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly service: PropertiesService,
  ) {}

  @Get()
  @Roles('tenant_admin', 'front_desk', 'night_auditor')
  async list(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest) {
    return this.prisma.withTenant(
      {
        tenantId: user.tenantId,
        actorId: user.sub,
        correlationId: typeof req.id === 'string' ? req.id : String(req.id),
      },
      (tx) =>
        tx.property.findMany({
          where: { deletedAt: null },
          orderBy: { code: 'asc' },
          select: {
            id: true,
            code: true,
            name: true,
            timezone: true,
            currency: true,
            locale: true,
            createdAt: true,
          },
        }),
    );
  }

  // -------------------------------------------------------------------------
  // Sprint 10 W4 — Back-office admin
  // -------------------------------------------------------------------------

  @Get(':id/settings')
  @Roles('tenant_admin', 'front_desk', 'night_auditor')
  async getSettings(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ) {
    return this.service.getSettings(user, corr(req), id);
  }

  @Put(':id/publish')
  @Roles('tenant_admin')
  async publish(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = PublishPropertyDto.parse(body);
    return this.service.setPublish(user, corr(req), id, input);
  }

  @Put(':id/channel-manager')
  @Roles('tenant_admin')
  async setChannelManager(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = ChannelManagerConfigDto.parse(body);
    return this.service.setChannelManager(user, corr(req), id, input);
  }

  @Put(':id/blocked-ips')
  @Roles('tenant_admin')
  async setBlockedIps(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = BlockedIpsDto.parse(body);
    return this.service.setBlockedIps(user, corr(req), id, input);
  }
}

function corr(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
