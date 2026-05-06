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
import { ConfirmToolDto, CreateSessionDto, SendMessageDto } from './dto';
import { CopilotService } from './copilot.service';

const ROLES = ['tenant_admin', 'front_desk', 'night_auditor'] as const;

@Controller('copilot/sessions')
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Post()
  @Roles(...ROLES)
  async createSession(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const input = CreateSessionDto.parse(body ?? {});
    return this.copilot.createSession(user, input.propertyId);
  }

  @Get(':id')
  @Roles(...ROLES)
  async getSession(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.copilot.getSession(user, id);
  }

  @Post(':id/messages')
  @Roles(...ROLES)
  async sendMessage(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = SendMessageDto.parse(body);
    return this.copilot.sendMessage(
      user,
      correlationIdOf(req),
      id,
      input.content,
    );
  }

  @Post(':id/confirm-tool')
  @Roles(...ROLES)
  async confirmTool(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = ConfirmToolDto.parse(body);
    return this.copilot.confirmTool(
      user,
      correlationIdOf(req),
      id,
      input.pendingToolId,
      input.decision,
    );
  }
}

function correlationIdOf(req: FastifyRequest): string {
  return typeof req.id === 'string' ? req.id : String(req.id);
}
