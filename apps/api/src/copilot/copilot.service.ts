import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CopilotMessageRole, Prisma } from '@pms/db';
import type { AuthUser } from '../auth';
import { PrismaService } from '../db';
import { COPILOT_ADAPTER } from './adapter-factory';
import {
  type AdapterTelemetry,
  type CopilotAdapter,
  type CopilotSessionState,
  type ToolProposal,
} from './copilot.types';
import type { AnyToolName } from './tool-resolver';
import { ToolResolver } from './tool-resolver';

/**
 * Conversational copilot. Sprint 2 W7 (FO) + Sprint 5 W5 (HSK cross-domain)
 * + Sprint 6 W1 (Anthropic adapter, prompt caching, audit en DB).
 *
 * Sessions live in memory keyed by sessionId. Production deployments back
 * this with Redis + a persistent store; para el MVP lo mantenemos in-process
 * y aceptamos el trade-off (sesiones se resetean al reiniciar la API).
 *
 * Cada turno se persiste en `copilot_messages` (USER, ASSISTANT, TOOL_USE,
 * TOOL_RESULT) con tokens + latency del adapter. Eso da auditoria legal
 * (quien pidio que, cuando) + observabilidad de coste por tenant.
 *
 * El cross-domain (Sprint 5) viene de delegar en `ToolResolver` que enruta
 * a `FoToolRouter` o `HskToolRouter` segun prefijo (`hsk_*` -> HSK).
 */
@Injectable()
export class CopilotService {
  private readonly log = new Logger(CopilotService.name);
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly resolver: ToolResolver,
    private readonly prisma: PrismaService,
    @Inject(COPILOT_ADAPTER) private readonly adapter: CopilotAdapter,
  ) {
    this.log.log(`Copilot init: adapter=${this.adapter.name}`);
  }

  createSession(user: AuthUser, propertyId: string | undefined): { sessionId: string } {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      id: sessionId,
      tenantId: user.tenantId,
      userId: user.sub,
      propertyId: propertyId ?? null,
      messages: [],
      pendingTools: new Map(),
      createdAt: new Date(),
    });
    return { sessionId };
  }

  getSession(user: AuthUser, sessionId: string): SessionView {
    const session = this.requireSession(user, sessionId);
    return toView(session);
  }

  async sendMessage(
    user: AuthUser,
    correlationId: string,
    sessionId: string,
    content: string,
  ): Promise<SessionView> {
    const session = this.requireSession(user, sessionId);

    session.messages.push({
      id: randomUUID(),
      role: 'user',
      content,
      createdAt: new Date(),
    });
    await this.persistMessage(user, session.id, {
      role: CopilotMessageRole.USER,
      contentText: content,
    });

    const adapterResult = await this.adapter.propose(
      this.snapshotForAdapter(session),
      user,
      correlationId,
      content,
    );
    const proposal = adapterResult.proposal;
    const telemetry = adapterResult.telemetry;

    if (proposal.kind === 'text') {
      session.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: proposal.text,
        createdAt: new Date(),
      });
      await this.persistMessage(user, session.id, {
        role: CopilotMessageRole.ASSISTANT,
        contentText: proposal.text,
        telemetry,
      });
      return toView(session);
    }

    // Tool intent: el agentic loop solo devuelve mutating aqui (los
    // read-only se ejecutan internamente en anthropicPropose).
    const meta = this.resolver.getMeta(proposal.tool);
    if (!meta.mutating) {
      // Fallback (stub path): si por algun motivo nos llega un read-only,
      // ejecuta y muestra.
      try {
        const result = await this.resolver.execute(
          proposal.tool,
          proposal.input,
          user,
          correlationId,
        );
        const text = `Resultado de ${proposal.tool}:\n\n\`\`\`json\n${truncateJson(result)}\n\`\`\``;
        session.messages.push({
          id: randomUUID(),
          role: 'assistant',
          content: text,
          createdAt: new Date(),
        });
        await this.persistMessage(user, session.id, {
          role: CopilotMessageRole.TOOL_RESULT,
          toolName: proposal.tool,
          toolInput: proposal.input as Prisma.InputJsonValue,
          toolResult: result as Prisma.InputJsonValue,
          telemetry,
        });
      } catch (err) {
        const errMsg = `No pude ejecutar ${proposal.tool}: ${(err as Error).message}`;
        session.messages.push({
          id: randomUUID(),
          role: 'assistant',
          content: errMsg,
          createdAt: new Date(),
        });
        await this.persistMessage(user, session.id, {
          role: CopilotMessageRole.TOOL_RESULT,
          toolName: proposal.tool,
          toolInput: proposal.input as Prisma.InputJsonValue,
          contentText: errMsg,
          telemetry,
        });
      }
      return toView(session);
    }

    // Mutating: queue for confirmation.
    const pendingId = randomUUID();
    session.pendingTools.set(pendingId, {
      id: pendingId,
      tool: proposal.tool,
      input: proposal.input,
      financial: meta.financial,
      createdAt: new Date(),
      status: 'pending',
    });
    const proposalMsg = `Sugerencia: ejecutar \`${proposal.tool}\`. Por seguridad necesito confirmación humana${
      meta.financial ? ' (acción financiera)' : ''
    }.`;
    session.messages.push({
      id: randomUUID(),
      role: 'assistant',
      content: proposalMsg,
      pendingToolId: pendingId,
      pendingTool: {
        name: proposal.tool,
        input: proposal.input,
        financial: meta.financial,
      },
      createdAt: new Date(),
    });
    await this.persistMessage(user, session.id, {
      role: CopilotMessageRole.TOOL_USE,
      toolName: proposal.tool,
      toolInput: proposal.input as Prisma.InputJsonValue,
      contentText: proposalMsg,
      telemetry,
    });
    return toView(session);
  }

  async confirmTool(
    user: AuthUser,
    correlationId: string,
    sessionId: string,
    pendingToolId: string,
    decision: 'approve' | 'reject',
  ): Promise<SessionView> {
    const session = this.requireSession(user, sessionId);
    const pending = session.pendingTools.get(pendingToolId);
    if (!pending) {
      throw new NotFoundException(`Pending tool ${pendingToolId} not found`);
    }
    if (pending.status !== 'pending') {
      throw new ConflictException(`Pending tool already in status ${pending.status}`);
    }

    if (decision === 'reject') {
      pending.status = 'rejected';
      const rejMsg = `Operación \`${pending.tool}\` rechazada por el operador.`;
      session.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: rejMsg,
        createdAt: new Date(),
      });
      await this.persistMessage(user, session.id, {
        role: CopilotMessageRole.ASSISTANT,
        contentText: rejMsg,
        toolName: pending.tool,
      });
      return toView(session);
    }

    try {
      const result = await this.resolver.execute(pending.tool, pending.input, user, correlationId);
      pending.status = 'approved';
      const okMsg = `Ejecutado \`${pending.tool}\`. Resultado:\n\n\`\`\`json\n${truncateJson(
        result,
      )}\n\`\`\``;
      session.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: okMsg,
        createdAt: new Date(),
      });
      await this.persistMessage(user, session.id, {
        role: CopilotMessageRole.TOOL_RESULT,
        toolName: pending.tool,
        toolInput: pending.input as Prisma.InputJsonValue,
        toolResult: result as Prisma.InputJsonValue,
        contentText: okMsg,
      });
    } catch (err) {
      pending.status = 'failed';
      const failMsg = `Falló \`${pending.tool}\`: ${(err as Error).message}`;
      session.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: failMsg,
        createdAt: new Date(),
      });
      await this.persistMessage(user, session.id, {
        role: CopilotMessageRole.TOOL_RESULT,
        toolName: pending.tool,
        toolInput: pending.input as Prisma.InputJsonValue,
        contentText: failMsg,
      });
    }

    return toView(session);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private snapshotForAdapter(session: Session): CopilotSessionState {
    return {
      id: session.id,
      tenantId: session.tenantId,
      userId: session.userId,
      propertyId: session.propertyId,
      messages: session.messages.map((m) => ({ role: m.role, content: m.content })),
    };
  }

  private async persistMessage(
    user: AuthUser,
    sessionId: string,
    fields: {
      role: CopilotMessageRole;
      contentText?: string | null;
      toolName?: string | null;
      toolInput?: Prisma.InputJsonValue | null;
      toolResult?: Prisma.InputJsonValue | null;
      telemetry?: AdapterTelemetry;
    },
  ): Promise<void> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId: sessionId };
    try {
      await this.prisma.withTenant(ctx, async (tx) => {
        await tx.copilotMessage.create({
          data: {
            tenantId: user.tenantId,
            sessionId,
            userId: user.sub,
            role: fields.role,
            contentText: fields.contentText ?? null,
            toolName: fields.toolName ?? null,
            toolInput: fields.toolInput ?? Prisma.JsonNull,
            toolResult: fields.toolResult ?? Prisma.JsonNull,
            model: fields.telemetry?.model ?? null,
            inputTokens: fields.telemetry?.inputTokens ?? null,
            outputTokens: fields.telemetry?.outputTokens ?? null,
            cacheReadTokens: fields.telemetry?.cacheReadTokens ?? null,
            cacheWriteTokens: fields.telemetry?.cacheWriteTokens ?? null,
            latencyMs: fields.telemetry?.latencyMs ?? null,
          },
        });
      });
    } catch (err) {
      // No bloqueamos al usuario por un fallo de auditoria — solo lo logueamos.
      this.log.warn(`copilot_messages persist failed: ${(err as Error).message}`);
    }
  }

  private requireSession(user: AuthUser, sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (session.tenantId !== user.tenantId) {
      throw new BadRequestException('Session does not belong to this tenant');
    }
    return session;
  }
}

function truncateJson(value: unknown, max = 1500): string {
  const json = JSON.stringify(value, null, 2);
  return json.length > max ? `${json.slice(0, max)}\n…(truncated)` : json;
}

// ---------------------------------------------------------------------------
// Internal session state
// ---------------------------------------------------------------------------

interface Session {
  id: string;
  tenantId: string;
  userId: string;
  propertyId: string | null;
  messages: SessionMessage[];
  pendingTools: Map<string, PendingTool>;
  createdAt: Date;
}

interface SessionMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pendingToolId?: string;
  pendingTool?: {
    name: AnyToolName;
    input: unknown;
    financial: boolean;
  };
  createdAt: Date;
}

interface PendingTool {
  id: string;
  tool: AnyToolName;
  input: unknown;
  financial: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'failed';
  createdAt: Date;
}

export type { ToolProposal };

export interface SessionView {
  sessionId: string;
  propertyId: string | null;
  createdAt: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    pendingToolId?: string;
    pendingTool?: {
      name: AnyToolName;
      input: unknown;
      financial: boolean;
    };
    createdAt: string;
  }>;
  pendingTools: Array<{
    id: string;
    tool: AnyToolName;
    input: unknown;
    financial: boolean;
    status: 'pending' | 'approved' | 'rejected' | 'failed';
    createdAt: string;
  }>;
}

function toView(session: Session): SessionView {
  return {
    sessionId: session.id,
    propertyId: session.propertyId,
    createdAt: session.createdAt.toISOString(),
    messages: session.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      pendingToolId: m.pendingToolId,
      pendingTool: m.pendingTool,
      createdAt: m.createdAt.toISOString(),
    })),
    pendingTools: [...session.pendingTools.values()].map((p) => ({
      id: p.id,
      tool: p.tool,
      input: p.input,
      financial: p.financial,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}
