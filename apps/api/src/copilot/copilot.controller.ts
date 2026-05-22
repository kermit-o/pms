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

  /**
   * Sprint 13 — vista admin: lista de sesiones recientes del tenant
   * para depurar prompt drift y revisar conversaciones del operador.
   * Sólo `tenant_admin`.
   *
   * Query params (todos opcionales):
   *  - `limit`: 1..200 (default 50).
   *  - `userId`: filtra por usuario del operador.
   *  - `from`/`to`: ventana sobre createdAt de mensajes (ISO).
   *  - `before`: cursor ISO para paginar hacia atrás (más antiguas).
   */
  @Get()
  @Roles('tenant_admin')
  async listSessions(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit: string | undefined,
    @Query('userId') userId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('before') before: string | undefined,
  ) {
    const parsed = limit ? Number(limit) : undefined;
    return this.copilot.listSessions(user, {
      limit: Number.isFinite(parsed) ? parsed : undefined,
      userId: userId || undefined,
      from: from || undefined,
      to: to || undefined,
      before: before || undefined,
    });
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
