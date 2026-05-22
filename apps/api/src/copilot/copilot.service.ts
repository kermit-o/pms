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
  type AdapterCallbacks,
  type AdapterTelemetry,
  type CopilotAdapter,
  type CopilotSessionState,
  type ToolProposal,
} from './copilot.types';
import { CopilotMetrics } from './metrics';
import type { AnyToolName } from './tool-resolver';
import type { CopilotWidget } from './widgets';
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
    private readonly metrics: CopilotMetrics,
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
    // Sprint 13 — persistir la sesión en DB para que sobreviva al
    // reinicio del proceso conservando su `propertyId`. Best-effort:
    // si la DB falla la sesión vive sólo en memoria (mismo
    // comportamiento que hasta este commit). El log queda visible
    // para diagnóstico.
    void this.persistSessionShell(user, sessionId, propertyId).catch((err) =>
      this.log.warn(`copilot.session persist failed (non-fatal) ${sessionId}: ${(err as Error).message}`),
    );
    return { sessionId };
  }

  private async persistSessionShell(
    user: AuthUser,
    sessionId: string,
    propertyId: string | undefined,
  ): Promise<void> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId: sessionId };
    await this.prisma.withTenant(ctx, (tx) =>
      tx.copilotSession.create({
        data: {
          id: sessionId,
          tenantId: user.tenantId,
          userId: user.sub,
          propertyId: propertyId ?? null,
        },
      }),
    );
  }

  /**
   * Sprint 13 — persiste un pending tool para que sobreviva al reload.
   * Best-effort: si la DB falla, el pending tool vive sólo en memoria
   * (comportamiento pre-commit). Estado inicial siempre 'pending'.
   */
  private async persistPendingTool(
    user: AuthUser,
    sessionId: string,
    pendingId: string,
    toolName: string,
    input: unknown,
    financial: boolean,
  ): Promise<void> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId: sessionId };
    await this.prisma.withTenant(ctx, (tx) =>
      tx.copilotPendingTool.create({
        data: {
          id: pendingId,
          sessionId,
          toolName,
          input: input as Prisma.InputJsonValue,
          financial,
          status: 'pending',
        },
      }),
    );
  }

  /**
   * Sprint 13 — actualiza el status del pending tool tras la decisión
   * del operador. Idempotente: el `where` incluye status=pending para
   * que decisiones duplicadas no rompan nada.
   */
  private async markPendingDecided(
    user: AuthUser,
    sessionId: string,
    pendingId: string,
    status: 'approved' | 'rejected' | 'failed',
  ): Promise<void> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId: sessionId };
    await this.prisma
      .withTenant(ctx, (tx) =>
        tx.copilotPendingTool.updateMany({
          where: { id: pendingId, status: 'pending' },
          data: { status, decidedAt: new Date() },
        }),
      )
      .catch((err) =>
        this.log.warn(
          `copilot.pending mark ${status} failed ${pendingId}: ${(err as Error).message}`,
        ),
      );
  }

  async getSession(user: AuthUser, sessionId: string): Promise<SessionView> {
    const session = await this.requireSession(user, sessionId);
    return toView(session);
  }

  /**
   * Sprint 13 — Lista de usuarios distintos que han tenido al menos una
   * sesión de Copilot en este tenant. Alimenta el `<select>` del filtro
   * en la vista admin para que el operador no tenga que pegar UUIDs.
   *
   * No optimizamos: usamos `groupBy({ by: userId })` sobre
   * `copilot_messages` + join con `users` para resolver `fullName`.
   * Cubre el caso piloto (decenas de operadores por hotel).
   */
  async listSessionUsers(user: AuthUser): Promise<AdminSessionUser[]> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId: 'admin-users' };
    return this.prisma.withTenant(ctx, async (tx) => {
      const distinct = await tx.copilotMessage.groupBy({
        by: ['userId'],
        _count: { sessionId: true },
        _max: { createdAt: true },
        orderBy: { _max: { createdAt: 'desc' } },
      });
      if (distinct.length === 0) return [];
      const users = await tx.user.findMany({
        where: { id: { in: distinct.map((d) => d.userId) } },
        select: { id: true, fullName: true, email: true },
      });
      const userById = new Map(users.map((u) => [u.id, u]));
      return distinct.map((d) => {
        const u = userById.get(d.userId);
        return {
          userId: d.userId,
          fullName: u?.fullName ?? null,
          email: u?.email ?? null,
          messageCount: d._count.sessionId,
          lastActivityAt: d._max.createdAt?.toISOString() ?? null,
        };
      });
    });
  }

  /**
   * Sprint 13 — Listado de sesiones para la vista admin
   * `/admin/copilot/sessions`. Devuelve un resumen por sesión (id, autor,
   * primer mensaje, contadores, última actividad) ordenado por última
   * actividad desc. Sólo `tenant_admin` lo consume (el controller lo
   * restringe).
   *
   * Filtros V1: `userId`, ventana `from`/`to` (sobre createdAt de cada
   * mensaje), cursor `before` (paginación por última actividad: el cliente
   * pasa el `lastActivityAt` del último row para pedir la página
   * siguiente, los más antiguos).
   *
   * Group-by se hace en aplicación tras leer las últimas N filas de
   * `copilot_messages`. Para volumetría de piloto (decenas de sesiones
   * por hotel/día) es suficiente; si crece se mete una vista
   * materializada. No optimizamos antes de tiempo.
   */
  async listSessions(
    user: AuthUser,
    opts: {
      limit?: number;
      userId?: string;
      from?: string;
      to?: string;
      /** Cursor ISO: devuelve sólo sesiones cuya última actividad sea < before. */
      before?: string;
    } = {},
  ): Promise<AdminSessionSummary[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const messageCap = limit * 10;
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId: 'admin-list' };

    const where: Prisma.CopilotMessageWhereInput = {};
    if (opts.userId) where.userId = opts.userId;
    if (opts.from || opts.to) {
      where.createdAt = {};
      if (opts.from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(opts.from);
      if (opts.to) (where.createdAt as Prisma.DateTimeFilter).lt = new Date(opts.to);
    }
    if (opts.before) {
      // Para que cursor funcione con el group-by post, leemos sólo mensajes
      // de antes del cursor. Cubre la mayoría de casos prácticos sin
      // necesitar window functions.
      const beforeDate = new Date(opts.before);
      where.createdAt = where.createdAt
        ? { ...(where.createdAt as Prisma.DateTimeFilter), lt: beforeDate }
        : { lt: beforeDate };
    }

    const rows = await this.prisma.withTenant(ctx, (tx) =>
      tx.copilotMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: messageCap,
        select: {
          sessionId: true,
          userId: true,
          role: true,
          contentText: true,
          createdAt: true,
          widgets: true,
        },
      }),
    );

    const bySession = new Map<string, AdminSessionSummary>();
    // Orden inverso: como rows viene desc, iteramos asc para que el
    // primer-mensaje quede como `firstMessage`. La última iteración
    // sobreescribe lastActivity con el más reciente.
    for (const r of [...rows].reverse()) {
      const existing = bySession.get(r.sessionId);
      if (!existing) {
        bySession.set(r.sessionId, {
          sessionId: r.sessionId,
          userId: r.userId,
          firstMessage:
            r.role === 'USER' && r.contentText ? r.contentText.slice(0, 140) : null,
          firstMessageAt: r.createdAt.toISOString(),
          lastActivityAt: r.createdAt.toISOString(),
          messageCount: 1,
          widgetCount: Array.isArray(r.widgets) ? (r.widgets as unknown[]).length : 0,
        });
      } else {
        existing.messageCount += 1;
        existing.lastActivityAt = r.createdAt.toISOString();
        if (Array.isArray(r.widgets)) {
          existing.widgetCount += (r.widgets as unknown[]).length;
        }
        if (!existing.firstMessage && r.role === 'USER' && r.contentText) {
          existing.firstMessage = r.contentText.slice(0, 140);
        }
      }
    }
    return [...bySession.values()]
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
      .slice(0, limit);
  }

  async sendMessage(
    user: AuthUser,
    correlationId: string,
    sessionId: string,
    content: string,
  ): Promise<SessionView> {
    return this.handleTurn(user, correlationId, sessionId, content);
  }

  /**
   * Generator que produce eventos SSE durante un turno completo:
   *  - status: thinking
   *  - tool_call: el adapter llamo a un read-only tool
   *  - tool_result: y obtuvo respuesta (ok | error)
   *  - done: turno completo, payload = SessionView final
   */
  async *sendMessageStream(
    user: AuthUser,
    correlationId: string,
    sessionId: string,
    content: string,
  ): AsyncGenerator<StreamEvent> {
    yield { type: 'status', phase: 'thinking' };
    const events: StreamEvent[] = [];
    const callbacks: AdapterCallbacks = {
      onToolUse: (tool) => events.push({ type: 'tool_call', tool }),
      onToolResult: (tool, ok) => events.push({ type: 'tool_result', tool, ok }),
    };
    // Acumulamos eventos del adapter en `events` y los ceden tras la
    // resolucion del turno. Para verdadero "live streaming" del modelo
    // este generator necesitara usar un canal real (EventEmitter o stream);
    // de momento la fase "thinking -> tool_call -> tool_result -> done"
    // ya da feedback visible durante loops largos del agente.
    const view = await this.handleTurn(user, correlationId, sessionId, content, callbacks);
    for (const ev of events) {
      yield ev;
    }
    yield { type: 'done', view };
  }

  private async handleTurn(
    user: AuthUser,
    correlationId: string,
    sessionId: string,
    content: string,
    callbacks?: AdapterCallbacks,
  ): Promise<SessionView> {
    const session = await this.requireSession(user, sessionId);

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
      callbacks,
    );
    const proposal = adapterResult.proposal;
    const telemetry = adapterResult.telemetry;

    if (proposal.kind === 'text') {
      session.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: proposal.text,
        widgets: proposal.widgets,
        createdAt: new Date(),
      });
      await this.persistMessage(user, session.id, {
        role: CopilotMessageRole.ASSISTANT,
        contentText: proposal.text,
        telemetry,
        widgets: proposal.widgets,
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
    // Sprint 13 — persistir el pending tool best-effort para que
    // sobreviva al reload (junto con el `pendingToolId` que se
    // adjunta al mensaje abajo, vía persistMessage).
    void this.persistPendingTool(
      user,
      sessionId,
      pendingId,
      proposal.tool,
      proposal.input,
      meta.financial,
    ).catch((err) =>
      this.log.warn(`copilot.pending persist failed ${pendingId}: ${(err as Error).message}`),
    );
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
      pendingToolId: pendingId,
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
    const session = await this.requireSession(user, sessionId);
    const pending = session.pendingTools.get(pendingToolId);
    if (!pending) {
      throw new NotFoundException(`Pending tool ${pendingToolId} not found`);
    }
    if (pending.status !== 'pending') {
      throw new ConflictException(`Pending tool already in status ${pending.status}`);
    }

    if (decision === 'reject') {
      pending.status = 'rejected';
      void this.markPendingDecided(user, session.id, pending.id, 'rejected');
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
      void this.markPendingDecided(user, session.id, pending.id, 'approved');
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
      void this.markPendingDecided(user, session.id, pending.id, 'failed');
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
      /** Sprint 13 — widgets emitidos por el adapter; se serializan JSON
       *  tal cual para audit + futuro reload-from-DB. */
      widgets?: CopilotWidget[];
      /** Sprint 13 — link al pending_tool si el mensaje es una
       *  propuesta mutating; permite rehidratar botones tras reload. */
      pendingToolId?: string | null;
    },
  ): Promise<void> {
    // Metricas: incrementar siempre, persistir DB best-effort.
    const model = fields.telemetry?.model ?? this.adapter.name;
    this.metrics.messages.add(1, { tenant: user.tenantId, role: fields.role, model });
    if (fields.telemetry) {
      const labels = { tenant: user.tenantId, model: fields.telemetry.model };
      if (fields.telemetry.inputTokens) {
        this.metrics.tokens.add(fields.telemetry.inputTokens, { ...labels, kind: 'input' });
      }
      if (fields.telemetry.outputTokens) {
        this.metrics.tokens.add(fields.telemetry.outputTokens, { ...labels, kind: 'output' });
      }
      if (fields.telemetry.cacheReadTokens) {
        this.metrics.tokens.add(fields.telemetry.cacheReadTokens, {
          ...labels,
          kind: 'cache_read',
        });
      }
      if (fields.telemetry.cacheWriteTokens) {
        this.metrics.tokens.add(fields.telemetry.cacheWriteTokens, {
          ...labels,
          kind: 'cache_write',
        });
      }
      this.metrics.latency.record(fields.telemetry.latencyMs / 1000, labels);
    }

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
            widgets:
              fields.widgets && fields.widgets.length > 0
                ? (fields.widgets as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            pendingToolId: fields.pendingToolId ?? null,
          },
        });
      });
    } catch (err) {
      // No bloqueamos al usuario por un fallo de auditoria — solo lo logueamos.
      this.log.warn(`copilot_messages persist failed: ${(err as Error).message}`);
    }
  }

  /**
   * Sprint 13 — devuelve la sesión desde memoria si existe; si no, intenta
   * hidratarla desde `copilot_messages`. Tras un deploy o reinicio del
   * proceso el Map in-memory queda vacío; este path evita perder la
   * conversación del operador.
   *
   * Limitaciones conocidas:
   *  - `propertyId` no se persiste (no hay tabla copilot_sessions), así
   *    que tras reload queda `null` y el LLM pedirá al usuario que lo
   *    confirme la primera vez que lo necesite.
   *  - `pendingTools` se persisten implícitamente como mensajes
   *    `tool_proposal` con su id en el contenido; tras reload se
   *    pierden — un mutating sin aprobar deja un mensaje viejo en el
   *    feed pero sin botones Approve/Reject. El usuario reformula y
   *    re-propone. Mejor que arrastrar pending tools potencialmente
   *    stale al reanudar.
   */
  private async requireSession(user: AuthUser, sessionId: string): Promise<Session> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (existing.tenantId !== user.tenantId) {
        throw new BadRequestException('Session does not belong to this tenant');
      }
      return existing;
    }
    const hydrated = await this.loadSessionFromDb(user, sessionId);
    if (!hydrated) throw new NotFoundException(`Session ${sessionId} not found`);
    this.sessions.set(sessionId, hydrated);
    this.log.log(
      `copilot.session hydrated from DB sessionId=${sessionId} messages=${hydrated.messages.length}`,
    );
    return hydrated;
  }

  private async loadSessionFromDb(
    user: AuthUser,
    sessionId: string,
  ): Promise<Session | null> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId: sessionId };
    return this.prisma.withTenant(ctx, async (tx) => {
      // Sprint 13 — cargamos shell + mensajes + pending tools en
      // paralelo. Sin shell se sigue cargando con propertyId=null
      // (retro-compat). Los pending tools rehidratan los botones
      // Approve/Reject tras un deploy.
      const [shell, rows, pendings] = await Promise.all([
        tx.copilotSession.findFirst({
          where: { id: sessionId, deletedAt: null },
          select: { propertyId: true, userId: true, createdAt: true },
        }),
        tx.copilotMessage.findMany({
          where: { sessionId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            contentText: true,
            widgets: true,
            pendingToolId: true,
            createdAt: true,
            userId: true,
          },
        }),
        tx.copilotPendingTool.findMany({
          where: { sessionId, status: 'pending' },
          select: {
            id: true,
            toolName: true,
            input: true,
            financial: true,
            createdAt: true,
          },
        }),
      ]);
      if (!shell && rows.length === 0) return null;
      const pendingToolsMap = new Map<string, PendingTool>();
      for (const p of pendings) {
        pendingToolsMap.set(p.id, {
          id: p.id,
          tool: p.toolName as AnyToolName,
          input: p.input,
          financial: p.financial,
          status: 'pending',
          createdAt: p.createdAt,
        });
      }
      const messages: SessionMessage[] = rows.map((r) => {
        const pendingToolId = r.pendingToolId ?? undefined;
        const pending = pendingToolId ? pendingToolsMap.get(pendingToolId) : undefined;
        return {
          id: r.id,
          role: r.role === CopilotMessageRole.USER ? 'user' : 'assistant',
          content: r.contentText ?? '',
          widgets: rowWidgets(r.widgets),
          pendingToolId: pending ? pendingToolId : undefined,
          pendingTool: pending
            ? { name: pending.tool, input: pending.input, financial: pending.financial }
            : undefined,
          createdAt: r.createdAt,
        };
      });
      return {
        id: sessionId,
        tenantId: user.tenantId,
        userId: shell?.userId ?? rows[0]?.userId ?? user.sub,
        propertyId: shell?.propertyId ?? null,
        messages,
        pendingTools: pendingToolsMap,
        createdAt: shell?.createdAt ?? rows[0]?.createdAt ?? new Date(),
      };
    });
  }
}

function truncateJson(value: unknown, max = 1500): string {
  const json = JSON.stringify(value, null, 2);
  return json.length > max ? `${json.slice(0, max)}\n…(truncated)` : json;
}

/**
 * Sprint 13 — Deserializa el campo `widgets jsonb` de copilot_messages a
 * `CopilotWidget[]`. Cualquier corrupción (mal serializado, schema cambió)
 * se ignora silenciosamente; mejor recuperar el mensaje sin tarjetas que
 * fallar la carga entera de la sesión.
 */
function rowWidgets(raw: Prisma.JsonValue | null): CopilotWidget[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  // Confiamos en lo que el adapter persistió en su día. Si la forma
  // cambió entre versiones, el cliente sabrá ignorar widgets desconocidos.
  return raw as unknown as CopilotWidget[];
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
  /** Sprint 13 W4 — widgets estructurados emitidos por tools read-only.
   *  Sólo en memoria por ahora; al recargar la sesión los mensajes
   *  vuelven sin widgets (la tarjeta desaparece pero el texto se
   *  conserva en DB). Persistencia llega con el siguiente slice. */
  widgets?: CopilotWidget[];
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

/** Sprint 13 — Item del selector de usuario en la vista admin. */
export interface AdminSessionUser {
  userId: string;
  fullName: string | null;
  email: string | null;
  messageCount: number;
  lastActivityAt: string | null;
}

/** Sprint 13 — Sumario que muestra la vista admin de sesiones. */
export interface AdminSessionSummary {
  sessionId: string;
  userId: string;
  /** Texto del primer mensaje del operador (≤140 chars) o null si la
   *  sesión sólo tenía mensajes del asistente. */
  firstMessage: string | null;
  firstMessageAt: string;
  lastActivityAt: string;
  messageCount: number;
  widgetCount: number;
}

export type StreamEvent =
  | { type: 'status'; phase: 'thinking' }
  | { type: 'tool_call'; tool: string }
  | { type: 'tool_result'; tool: string; ok: boolean }
  | { type: 'done'; view: SessionView };

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
    widgets?: CopilotWidget[];
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
      widgets: m.widgets,
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
