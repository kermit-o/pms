import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser, Roles } from '../auth';
import type { AuthUser } from '../auth';
import { ConfirmToolDto, CreateSessionDto, SendMessageDto } from './dto';
import { CopilotService, type StreamEvent } from './copilot.service';

const ROLES = ['tenant_admin', 'front_desk', 'night_auditor'] as const;

@Controller('copilot/sessions')
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Post()
  @Roles(...ROLES)
  async createSession(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = CreateSessionDto.parse(body ?? {});
    return this.copilot.createSession(user, input.propertyId);
  }

  @Get(':id')
  @Roles(...ROLES)
  async getSession(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.copilot.getSession(user, id);
  }

  @Post(':id/messages')
  @Roles(...ROLES)
  async sendMessage(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('stream') streamFlag: string | undefined,
    @Body() body: unknown,
  ) {
    const input = SendMessageDto.parse(body);
    const cid = correlationIdOf(req);
    if (streamFlag === 'true') {
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.flushHeaders?.();
      try {
        for await (const ev of this.copilot.sendMessageStream(user, cid, id, input.content)) {
          writeSse(reply, ev);
        }
      } catch (err) {
        writeSse(reply, { type: 'error', message: (err as Error).message });
      }
      reply.raw.end();
      return reply;
    }
    return this.copilot.sendMessage(user, cid, id, input.content);
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

type SseFrame = StreamEvent | { type: 'error'; message: string };

function writeSse(reply: FastifyReply, frame: SseFrame): void {
  reply.raw.write(`event: ${frame.type}\n`);
  reply.raw.write(`data: ${JSON.stringify(frame)}\n\n`);
}
