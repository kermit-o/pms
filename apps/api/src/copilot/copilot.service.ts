import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { foToolCatalog, hskToolCatalog } from '@pms/mcp-tools';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AuthUser } from '../auth';
import type { Env } from '../config/env.schema';
import { type AnyToolName, ToolResolver } from './tool-resolver';

/**
 * Conversational copilot. Sprint 2 W7 (FO) + Sprint 5 W5 (HSK cross-domain).
 *
 * Sessions live in memory keyed by sessionId. Production deployments back
 * this with Redis + a persistent store; para el MVP lo mantenemos in-process
 * y aceptamos el trade-off (sesiones se resetean al reiniciar la API).
 *
 * Flow:
 *  1. El operador abre una sesion.
 *  2. Cada mensaje del usuario se acumula en la sesion y va al adapter LLM
 *     (Anthropic real cuando ANTHROPIC_API_KEY esta seteado; stub
 *     deterministico si no — tests usan stub).
 *  3. El adapter emite (a) texto asistente, (b) intent de tool con dominio
 *     FO o HSK. Read-only auto-ejecuta; mutating va a `pendingTools` y la
 *     UI surface confirmacion (ADR-020).
 *  4. confirmTool() ejecuta el tool pendiente con la decision del operador.
 *     El resolver re-valida Zod input, RLS via tenant context, financial
 *     no se ejecuta sin "approve" explicito.
 *
 * El cross-domain (Sprint 5) viene de delegar en `ToolResolver` que enruta
 * a `FoToolRouter` o `HskToolRouter` segun prefijo (`hsk_*` -> HSK).
 */
@Injectable()
export class CopilotService {
  private readonly log = new Logger(CopilotService.name);
  private readonly sessions = new Map<string, Session>();
  private readonly anthropicApiKey: string | undefined;

  constructor(
    private readonly resolver: ToolResolver,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.anthropicApiKey = this.config.get('ANTHROPIC_API_KEY', { infer: true });
    this.log.log(
      `Copilot init: anthropic=${this.anthropicApiKey ? 'present(' + this.anthropicApiKey.length + 'ch)' : 'absent'}`,
    );
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
    const meta = this.resolver.getMeta(proposal.tool);
    if (!meta.mutating) {
      // Auto-execute read-only.
      try {
        const result = await this.resolver.execute(
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
      const result = await this.resolver.execute(pending.tool, pending.input, user, correlationId);
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
   * Pregunta al modelo que hacer. Con ANTHROPIC_API_KEY haria la llamada
   * real a Anthropic Messages exponiendo TODO el catalogo (FO + HSK) via
   * tool_use. Sin la key cae al stub deterministico — suficiente para
   * tests y demos.
   */
  private async proposeReply(session: Session, content: string): Promise<ToolProposal> {
    if (!this.anthropicApiKey) {
      this.log.warn('Anthropic key absent, using stub');
      return stubProposal(content);
    }
    try {
      this.log.log(`Anthropic propose: msg="${content.slice(0, 60)}"`);
      const result = await this.anthropicPropose(session, content);
      this.log.log(`Anthropic result kind=${result.kind}`);
      return result;
    } catch (err) {
      this.log.error('Anthropic adapter error, falling back to stub', err as Error);
      return stubProposal(content);
    }
  }

  private async anthropicPropose(session: Session, _content: string): Promise<ToolProposal> {
    const client = new Anthropic({ apiKey: this.anthropicApiKey });

    const messages: Anthropic.Messages.MessageParam[] = session.messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    const tools = buildAnthropicTools();

    const propertyHint = session.propertyId
      ? `Property activa: ${session.propertyId}. Usala como propertyId por defecto.`
      : 'Si necesitas propertyId pide al usuario que lo confirme.';

    const system = [
      'Eres Aubergine, copiloto operativo de un PMS hotelero.',
      'Responde en español, breve, profesional. Usa los tools cuando aplique.',
      'Para mutaciones (crear reserva, check-in/out, cargos) la UI pide',
      'confirmacion humana — propon el tool con sus args y un texto corto.',
      'Para read-only ejecuta directo. Fechas siempre YYYY-MM-DD.',
      propertyHint,
    ].join(' ');

    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system,
      tools,
      messages,
    });

    // Busca primero un tool_use block.
    for (const block of resp.content) {
      if (block.type === 'tool_use') {
        const toolName = block.name;
        if (this.resolver.has(toolName)) {
          return { kind: 'tool', tool: toolName as AnyToolName, input: block.input };
        }
        this.log.warn(`Anthropic returned unknown tool: ${toolName}`);
      }
    }

    // Si no, junta los text blocks.
    const text = resp.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return { kind: 'text', text: text || '…' };
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
 * Reconocedor deterministico de intents. Intencionalmente estrecho: pilla
 * unas pocas frases que mapean limpiamente a tools read-only / mutating
 * y surface un hint cuando faltan args en lugar de adivinar. El modelo
 * real reemplaza esto sin tocar el contrato.
 */
export function stubProposal(content: string): ToolProposal {
  const lower = content.toLowerCase();
  const uuids = content.match(new RegExp(UUID_RE, 'gi')) ?? [];
  const dates = content.match(new RegExp(ISO_DATE_RE, 'g')) ?? [];

  // -------- HSK ---------------------------------------------------------
  if (
    /(sugiere|sugerencia|sugerencias).*(asignaci[oó]n|tareas|limpieza)/i.test(lower) &&
    uuids[0]
  ) {
    return {
      kind: 'tool',
      tool: 'hsk_suggest_assignments',
      input: { propertyId: uuids[0], businessDate: dates[0] },
    };
  }

  if (
    /(qu[eé] tareas|tareas (de )?hoy|listar tareas|tareas (asignadas )?(tiene|de))/i.test(lower) &&
    uuids[0]
  ) {
    return {
      kind: 'tool',
      tool: 'hsk_list_today',
      input: {
        propertyId: uuids[0],
        businessDate: dates[0],
        assignedToUserId: uuids[1],
      },
    };
  }

  if (/(empezar|iniciar) (la |una )?(tarea|limpieza)/i.test(lower) && uuids[0]) {
    return {
      kind: 'tool',
      tool: 'hsk_start_task',
      input: { taskId: uuids[0] },
    };
  }

  if (/(completar|finalizar|terminar) (la |una )?(tarea|limpieza)/i.test(lower) && uuids[0]) {
    return {
      kind: 'tool',
      tool: 'hsk_complete_task',
      input: { taskId: uuids[0] },
    };
  }

  if (
    /(asign[ao]r? (limpieza|tarea|housekeeping)|crear tarea (de limpieza|hsk))/i.test(lower) &&
    uuids[0] &&
    uuids[1] &&
    dates[0]
  ) {
    return {
      kind: 'tool',
      tool: 'hsk_assign_task',
      input: {
        propertyId: uuids[0],
        roomId: uuids[1],
        businessDate: dates[0],
        assignedToUserId: uuids[2],
      },
    };
  }

  // -------- FO ----------------------------------------------------------
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

  if (/(res[uú]me?n|report|reporte)/i.test(lower) && uuids[0] && dates[0]) {
    const focus: 'overview' | 'revenue' | 'occupancy' | 'incidents' =
      /ingres[oó]s|revenue|adr|revpar/i.test(lower)
        ? 'revenue'
        : /ocupaci[oó]n|occupancy/i.test(lower)
          ? 'occupancy'
          : /incidente|cancelaci[oó]n/i.test(lower)
            ? 'incidents'
            : 'overview';
    return {
      kind: 'tool',
      tool: 'generate_report',
      input: { propertyId: uuids[0], businessDate: dates[0], focus },
    };
  }

  return {
    kind: 'text',
    text:
      'Puedo ayudarte con FO (disponibilidad, check-in, asignar habitación, resúmenes) ' +
      'o HSK (asignar / iniciar / completar tareas, listar tareas del día, sugerir ' +
      'asignaciones). Ej: "qué tareas tiene <userId> hoy en <propertyId>" o ' +
      '"sugiere asignaciones para <propertyId> el <YYYY-MM-DD>".',
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

export type ToolProposal =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tool: AnyToolName; input: unknown };

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

// ---------------------------------------------------------------------------
// Anthropic tools build
// ---------------------------------------------------------------------------

type ToolMetaShape = { name: string; description: string; inputSchema: unknown };

function buildAnthropicTools(): Anthropic.Messages.Tool[] {
  const out: Anthropic.Messages.Tool[] = [];
  const catalogs: Record<string, ToolMetaShape>[] = [
    foToolCatalog as unknown as Record<string, ToolMetaShape>,
    hskToolCatalog as unknown as Record<string, ToolMetaShape>,
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toJson = zodToJsonSchema as unknown as (schema: any) => Record<string, unknown>;
  for (const cat of catalogs) {
    for (const meta of Object.values(cat)) {
      out.push({
        name: meta.name,
        description: meta.description,
        input_schema: toJson(meta.inputSchema) as Anthropic.Messages.Tool.InputSchema,
      });
    }
  }
  return out;
}
