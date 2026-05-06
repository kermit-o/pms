import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { type FoToolName, foToolCatalog } from '@pms/mcp-tools';
import type { AuthUser } from '../auth';
import type { Env } from '../config/env.schema';
import { FoToolRouter } from './tool-router';

/**
 * Conversational copilot for FO. Sprint 2 W7.
 *
 * Sessions live in memory keyed by sessionId. Production deployments back
 * this with Redis + a persistent store; for the MVP we keep it in-process
 * and accept the trade-off (sessions reset on API restart).
 *
 * Flow:
 *  1. The operator opens a session.
 *  2. Each user message is appended to the session and sent to the LLM
 *     adapter (real Anthropic when ANTHROPIC_API_KEY is set; a deterministic
 *     stub otherwise — tests use the stub, dev defaults to it).
 *  3. The adapter may emit either an assistant text reply or a "tool_use"
 *     intent. Read-only tools auto-execute and a follow-up assistant turn
 *     summarises the result. Mutating tools land in `pendingTools` and the
 *     UI surfaces a confirmation dialog.
 *  4. confirmTool() executes the pending tool when the operator approves
 *     (defence in depth: the router still re-validates Zod input, RLS still
 *     applies via tenant context, and financial tools refuse to execute
 *     without an explicit "approve" decision).
 */
@Injectable()
export class CopilotService {
  private readonly log = new Logger(CopilotService.name);
  private readonly sessions = new Map<string, Session>();
  private readonly anthropicApiKey: string | undefined;

  constructor(
    private readonly router: FoToolRouter,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.anthropicApiKey = this.config.get('ANTHROPIC_API_KEY', { infer: true });
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

    const proposal = await this.proposeReply(session, content);

    if (proposal.kind === 'text') {
      session.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: proposal.text,
        createdAt: new Date(),
      });
      return toView(session);
    }

    // Tool intent.
    const meta = foToolCatalog[proposal.tool];
    if (!meta.mutating) {
      // Auto-execute read-only.
      try {
        const result = await this.router.execute(
          proposal.tool,
          proposal.input,
          user,
          correlationId,
        );
        session.messages.push({
          id: randomUUID(),
          role: 'assistant',
          content: `He consultado \`${proposal.tool}\`. Resultado:\n\n\`\`\`json\n${truncateJson(
            result,
          )}\n\`\`\``,
          createdAt: new Date(),
        });
      } catch (err) {
        session.messages.push({
          id: randomUUID(),
          role: 'assistant',
          content: `No pude ejecutar \`${proposal.tool}\`: ${(err as Error).message}`,
          createdAt: new Date(),
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
    session.messages.push({
      id: randomUUID(),
      role: 'assistant',
      content: `Sugerencia: ejecutar \`${proposal.tool}\`. Por seguridad necesito confirmación humana${
        meta.financial ? ' (acción financiera)' : ''
      }.`,
      pendingToolId: pendingId,
      pendingTool: {
        name: proposal.tool,
        input: proposal.input,
        financial: meta.financial,
      },
      createdAt: new Date(),
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
      session.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: `Operación \`${pending.tool}\` rechazada por el operador.`,
        createdAt: new Date(),
      });
      return toView(session);
    }

    try {
      const result = await this.router.execute(pending.tool, pending.input, user, correlationId);
      pending.status = 'approved';
      session.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: `Ejecutado \`${pending.tool}\`. Resultado:\n\n\`\`\`json\n${truncateJson(
          result,
        )}\n\`\`\``,
        createdAt: new Date(),
      });
    } catch (err) {
      pending.status = 'failed';
      session.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: `Falló \`${pending.tool}\`: ${(err as Error).message}`,
        createdAt: new Date(),
      });
    }

    return toView(session);
  }

  // -------------------------------------------------------------------------
  // LLM adapter
  // -------------------------------------------------------------------------

  /**
   * Asks the underlying model what to do next. With ANTHROPIC_API_KEY set,
   * this would call the real Anthropic Messages API with the FO tool catalog
   * exposed via tool_use. Without it, we fall back to a deterministic stub
   * that recognises a few intents — enough for tests and demos.
   */
  private async proposeReply(_session: Session, content: string): Promise<ToolProposal> {
    if (!this.anthropicApiKey) {
      return stubProposal(content);
    }
    // Real Anthropic integration is wired in a follow-up; the stub keeps
    // the surface deterministic until then.
    return stubProposal(content);
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

// ---------------------------------------------------------------------------
// Stub adapter
// ---------------------------------------------------------------------------

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;

/**
 * Tiny deterministic intent recogniser. It is intentionally narrow: it picks
 * up a couple of phrasings that map cleanly to read-only / mutating tools and
 * surfaces a hint when arguments are missing, rather than guessing. The real
 * model will replace this without changing the contract above it.
 */
function stubProposal(content: string): ToolProposal {
  const lower = content.toLowerCase();
  const uuids = content.match(new RegExp(UUID_RE, 'gi')) ?? [];
  const dates = content.match(new RegExp(ISO_DATE_RE, 'g')) ?? [];

  if (
    /(disponibilidad|availability|libres?|huecos?)/i.test(lower) &&
    uuids[0] &&
    dates[0] &&
    dates[1]
  ) {
    return {
      kind: 'tool',
      tool: 'query_availability',
      input: { propertyId: uuids[0], from: dates[0], to: dates[1] },
    };
  }

  if (/(check[- ]?in|registrar entrada)/i.test(lower) && uuids[0]) {
    return {
      kind: 'tool',
      tool: 'check_in',
      input: { reservationId: uuids[0], roomId: uuids[1] },
    };
  }

  if (/(asign[ao]r? habitaci[oó]n|assign room)/i.test(lower) && uuids[0] && uuids[1]) {
    return {
      kind: 'tool',
      tool: 'assign_room',
      input: { reservationId: uuids[0], roomId: uuids[1] },
    };
  }

  return {
    kind: 'text',
    text:
      'Puedo consultar disponibilidad, asignar habitación o iniciar un check-in. ' +
      'Por ejemplo: "consulta disponibilidad para <propertyId> del <YYYY-MM-DD> al <YYYY-MM-DD>".',
  };
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
    name: FoToolName;
    input: unknown;
    financial: boolean;
  };
  createdAt: Date;
}

interface PendingTool {
  id: string;
  tool: FoToolName;
  input: unknown;
  financial: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'failed';
  createdAt: Date;
}

type ToolProposal =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tool: FoToolName; input: unknown };

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
      name: FoToolName;
      input: unknown;
      financial: boolean;
    };
    createdAt: string;
  }>;
  pendingTools: Array<{
    id: string;
    tool: FoToolName;
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
