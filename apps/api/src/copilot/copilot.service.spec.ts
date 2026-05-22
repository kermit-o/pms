import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth';
import { CopilotService } from './copilot.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333';
const ROOM_TYPE_ID = '44444444-4444-4444-4444-444444444444';
const RESERVATION_ID = '55555555-5555-5555-5555-555555555555';
const ROOM_ID = '66666666-6666-6666-6666-666666666666';
const TASK_ID = '77777777-7777-7777-7777-777777777777';
const CAM_ID = '88888888-8888-8888-8888-888888888888';

const user: AuthUser = {
  sub: USER_ID,
  tenantId: TENANT_ID,
  email: 'desk@hotel.test',
  roles: ['front_desk'],
};

// Read-only tools auto-execute; mutating queue for confirmation; financial
// (un subset de mutating) requiere approve explicito antes de ejecutar.
const READ_ONLY = new Set([
  'query_availability',
  'generate_report',
  'hsk_list_today',
  'hsk_suggest_assignments',
]);
const FINANCIAL = new Set(['add_folio_charge', 'check_out']);

function buildService() {
  const resolver = {
    has: vi.fn().mockReturnValue(true),
    domain: vi.fn().mockImplementation((name: string) => (name.startsWith('hsk_') ? 'hsk' : 'fo')),
    getMeta: vi.fn().mockImplementation((name: string) => ({
      name,
      description: `mock ${name}`,
      mutating: !READ_ONLY.has(name),
      financial: FINANCIAL.has(name),
    })),
    isMutating: vi.fn().mockImplementation((name: string) => !READ_ONLY.has(name)),
    isFinancial: vi.fn().mockImplementation((name: string) => FINANCIAL.has(name)),
    execute: vi.fn().mockResolvedValue({ ok: true }),
    tryValidate: vi.fn().mockReturnValue({ ok: true }),
  };
  // Stub adapter: tests no llaman al modelo real. El service usa el adapter
  // inyectado y persiste en DB via prisma.withTenant — usamos un noop.
  const adapter = {
    name: 'stub' as const,
    propose: vi.fn(async (_session, _user, _cid, content: string) => {
      const { stubProposal } = await import('./stub-adapter');
      return { proposal: stubProposal(content) };
    }),
  };
  const findManyMock = vi.fn().mockResolvedValue([] as unknown[]);
  const groupByMock = vi.fn().mockResolvedValue([] as unknown[]);
  const userFindManyMock = vi.fn().mockResolvedValue([] as unknown[]);
  const prisma = {
    withTenant: vi.fn(async (_ctx, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        copilotMessage: {
          create: vi.fn().mockResolvedValue({}),
          findMany: findManyMock,
          groupBy: groupByMock,
        },
        user: {
          findMany: userFindManyMock,
        },
      }),
    ),
  };
  const metrics = {
    messages: { add: vi.fn() },
    tokens: { add: vi.fn() },
    latency: { record: vi.fn() },
  };
  const service = new CopilotService(
    resolver as never,
    prisma as never,
    adapter as never,
    metrics as never,
  );
  return { service, resolver, findManyMock, groupByMock, userFindManyMock };
}

describe('CopilotService', () => {
  it('opens a session scoped to the user tenant', async () => {
    const { service } = buildService();
    const out = service.createSession(user, PROPERTY_ID);
    expect(out.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const view = await service.getSession(user, out.sessionId);
    expect(view.propertyId).toBe(PROPERTY_ID);
    expect(view.messages).toEqual([]);
  });

  it('returns an explanatory text reply when intent is unclear', async () => {
    const { service } = buildService();
    const { sessionId } = service.createSession(user, undefined);
    const view = await service.sendMessage(user, 'corr', sessionId, 'hola, ayuda');
    expect(view.messages).toHaveLength(2);
    expect(view.messages[1]!.role).toBe('assistant');
    // El nuevo texto menciona FO y HSK.
    expect(view.messages[1]!.content).toMatch(/FO/);
    expect(view.messages[1]!.content).toMatch(/HSK/);
  });

  it('auto-executes read-only tool (query_availability) and summarises result', async () => {
    const { service, resolver } = buildService();
    const { sessionId } = service.createSession(user, undefined);
    const view = await service.sendMessage(
      user,
      'corr',
      sessionId,
      `consulta disponibilidad para ${PROPERTY_ID} del 2026-06-10 al 2026-06-12`,
    );
    expect(resolver.execute).toHaveBeenCalledOnce();
    expect(resolver.execute.mock.calls[0]![0]).toBe('query_availability');
    expect(view.messages.at(-1)!.content).toContain('query_availability');
    expect(view.pendingTools).toHaveLength(0);
  });

  it('queues a mutating tool for confirmation instead of executing it', async () => {
    const { service, resolver } = buildService();
    const { sessionId } = service.createSession(user, undefined);
    const view = await service.sendMessage(
      user,
      'corr',
      sessionId,
      `haz check-in del ${RESERVATION_ID} en la habitacion ${ROOM_ID}`,
    );
    expect(resolver.execute).not.toHaveBeenCalled();
    expect(view.pendingTools).toHaveLength(1);
    expect(view.pendingTools[0]!.tool).toBe('check_in');
    expect(view.pendingTools[0]!.status).toBe('pending');
    expect(view.messages.at(-1)!.pendingTool?.name).toBe('check_in');
  });

  it('confirmTool(approve) executes the pending tool and marks it approved', async () => {
    const { service, resolver } = buildService();
    const { sessionId } = service.createSession(user, undefined);
    const proposed = await service.sendMessage(
      user,
      'corr',
      sessionId,
      `haz check-in del ${RESERVATION_ID} en la habitacion ${ROOM_ID}`,
    );
    const pendingId = proposed.pendingTools[0]!.id;
    const view = await service.confirmTool(user, 'corr', sessionId, pendingId, 'approve');
    expect(resolver.execute).toHaveBeenCalledOnce();
    expect(view.pendingTools[0]!.status).toBe('approved');
    expect(view.messages.at(-1)!.content).toContain('Ejecutado');
  });

  it('confirmTool(reject) does not execute and marks rejected', async () => {
    const { service, resolver } = buildService();
    const { sessionId } = service.createSession(user, undefined);
    const proposed = await service.sendMessage(
      user,
      'corr',
      sessionId,
      `asignar habitacion ${ROOM_ID} a la reserva ${RESERVATION_ID}`,
    );
    const pendingId = proposed.pendingTools[0]!.id;
    const view = await service.confirmTool(user, 'corr', sessionId, pendingId, 'reject');
    expect(resolver.execute).not.toHaveBeenCalled();
    expect(view.pendingTools[0]!.status).toBe('rejected');
    expect(view.messages.at(-1)!.content).toContain('rechazada');
  });

  it('rejects sessions that belong to another tenant', async () => {
    const { service } = buildService();
    const { sessionId } = service.createSession(user, undefined);
    const otherUser: AuthUser = {
      sub: USER_ID,
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      email: 'other@example.com',
      roles: ['front_desk'],
    };
    await expect(service.getSession(otherUser, sessionId)).rejects.toThrow();
  });

  // Ensures the test is self-consistent: ROOM_TYPE_ID is unused but kept as a
  // real UUID in case future intents reference it.
  it('exposes constants for follow-up tests', () => {
    expect(ROOM_TYPE_ID).toMatch(/^[0-9a-f-]{36}$/);
  });

  // ---- HSK cross-domain (Sprint 5 W5) -----------------------------------

  it('auto-executes hsk_list_today (read-only) when supervisor asks for daily tasks', async () => {
    const { service, resolver } = buildService();
    const { sessionId } = service.createSession(user, undefined);
    const view = await service.sendMessage(
      user,
      'corr',
      sessionId,
      `qué tareas tiene ${CAM_ID} hoy en ${PROPERTY_ID}`,
    );
    expect(resolver.execute).toHaveBeenCalledOnce();
    expect(resolver.execute.mock.calls[0]![0]).toBe('hsk_list_today');
    expect(view.messages.at(-1)!.content).toContain('hsk_list_today');
    expect(view.pendingTools).toHaveLength(0);
  });

  it('auto-executes hsk_suggest_assignments and surfaces tool name', async () => {
    const { service, resolver } = buildService();
    const { sessionId } = service.createSession(user, undefined);
    await service.sendMessage(
      user,
      'corr',
      sessionId,
      `sugiere asignaciones para ${PROPERTY_ID} el 2026-06-10`,
    );
    expect(resolver.execute).toHaveBeenCalledOnce();
    expect(resolver.execute.mock.calls[0]![0]).toBe('hsk_suggest_assignments');
  });

  it('queues hsk_start_task (mutating) for confirmation', async () => {
    const { service, resolver } = buildService();
    const { sessionId } = service.createSession(user, undefined);
    const view = await service.sendMessage(user, 'corr', sessionId, `iniciar la tarea ${TASK_ID}`);
    expect(resolver.execute).not.toHaveBeenCalled();
    expect(view.pendingTools).toHaveLength(1);
    expect(view.pendingTools[0]!.tool).toBe('hsk_start_task');
    expect(view.pendingTools[0]!.status).toBe('pending');
  });

  it('queues hsk_assign_task (mutating) when supervisor asks to assign', async () => {
    const { service, resolver } = buildService();
    const { sessionId } = service.createSession(user, undefined);
    const view = await service.sendMessage(
      user,
      'corr',
      sessionId,
      `asignar limpieza para ${PROPERTY_ID} en habitación ${ROOM_ID} el 2026-06-10 a ${CAM_ID}`,
    );
    expect(resolver.execute).not.toHaveBeenCalled();
    expect(view.pendingTools[0]!.tool).toBe('hsk_assign_task');
  });

  it('sendMessageStream emits status -> done events for stub adapter', async () => {
    const { service } = buildService();
    const { sessionId } = service.createSession(user, undefined);
    const events: Array<{ type: string }> = [];
    for await (const ev of service.sendMessageStream(
      user,
      'corr',
      sessionId,
      `consultar disponibilidad de ${PROPERTY_ID} entre 2026-06-10 y 2026-06-12`,
    )) {
      events.push(ev);
    }
    // Stub no encadena tools internamente, asi que solo veremos status + done.
    expect(events[0]).toEqual({ type: 'status', phase: 'thinking' });
    expect(events[events.length - 1]!.type).toBe('done');
  });

  // ---------------------------------------------------------------------------
  // Sprint 13 — reload-from-DB de sesiones (cierra el loop de slice 2).
  // ---------------------------------------------------------------------------

  it('reload: hydrata una sesión desde DB cuando el Map in-memory no la tiene', async () => {
    const { service, findManyMock } = buildService();
    const sessionId = '99999999-9999-9999-9999-999999999999';
    findManyMock.mockResolvedValueOnce([
      {
        id: 'msg-1',
        role: 'USER',
        contentText: '¿qué precios hay el lunes?',
        widgets: null,
        userId: user.sub,
        createdAt: new Date('2026-05-21T09:00:00Z'),
      },
      {
        id: 'msg-2',
        role: 'ASSISTANT',
        contentText: 'Hay 3 tipos disponibles esa noche.',
        widgets: [
          {
            kind: 'availability',
            data: {
              arrival: '2026-05-26',
              departure: '2026-05-27',
              nights: 1,
              rows: [],
            },
          },
        ],
        userId: user.sub,
        createdAt: new Date('2026-05-21T09:00:10Z'),
      },
    ]);
    const view = await service.getSession(user, sessionId);
    expect(view.sessionId).toBe(sessionId);
    expect(view.messages).toHaveLength(2);
    expect(view.messages[0]!.role).toBe('user');
    expect(view.messages[1]!.role).toBe('assistant');
    expect(view.messages[1]!.widgets).toHaveLength(1);
    // propertyId se pierde tras reload (no hay tabla copilot_sessions).
    expect(view.propertyId).toBeNull();
    // pendingTools se descartan tras reload.
    expect(view.pendingTools).toEqual([]);
  });

  it('reload: 404 cuando la sesión no tiene mensajes en DB', async () => {
    const { service, findManyMock } = buildService();
    findManyMock.mockResolvedValueOnce([]);
    await expect(
      service.getSession(user, '88888888-8888-8888-8888-888888888888'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('reload: una sesión ya en memoria no toca DB', async () => {
    const { service, findManyMock } = buildService();
    const { sessionId } = service.createSession(user, PROPERTY_ID);
    findManyMock.mockClear();
    const view = await service.getSession(user, sessionId);
    expect(view.propertyId).toBe(PROPERTY_ID);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Sprint 13 — listSessions (vista admin).
  // ---------------------------------------------------------------------------

  it('listSessions agrupa por sessionId y ordena por última actividad desc', async () => {
    const { service, findManyMock } = buildService();
    // 2 sesiones: la "newer" tiene actividad más reciente que la "older".
    findManyMock.mockResolvedValueOnce([
      // Row 1 (más reciente): assistant en newer.
      {
        sessionId: 'newer',
        userId: user.sub,
        role: 'ASSISTANT',
        contentText: 'OK',
        createdAt: new Date('2026-05-22T11:00:00Z'),
        widgets: [{ kind: 'availability' }],
      },
      // Row 2: user en newer.
      {
        sessionId: 'newer',
        userId: user.sub,
        role: 'USER',
        contentText: '¿precios mañana?',
        createdAt: new Date('2026-05-22T10:55:00Z'),
        widgets: null,
      },
      // Row 3 (más antigua de las 3): user en older.
      {
        sessionId: 'older',
        userId: user.sub,
        role: 'USER',
        contentText: '¿quién tiene la 305?',
        createdAt: new Date('2026-05-22T09:00:00Z'),
        widgets: null,
      },
    ]);
    const out = await service.listSessions(user, { limit: 10 });
    expect(out).toHaveLength(2);
    expect(out[0]!.sessionId).toBe('newer');
    expect(out[0]!.messageCount).toBe(2);
    expect(out[0]!.firstMessage).toBe('¿precios mañana?');
    expect(out[0]!.widgetCount).toBe(1);
    expect(out[1]!.sessionId).toBe('older');
    expect(out[1]!.messageCount).toBe(1);
  });

  it('listSessions respeta el limit y devuelve sólo las N más recientes', async () => {
    const { service, findManyMock } = buildService();
    findManyMock.mockResolvedValueOnce([
      {
        sessionId: 's-1',
        userId: user.sub,
        role: 'USER',
        contentText: 'a',
        createdAt: new Date('2026-05-22T11:00:00Z'),
        widgets: null,
      },
      {
        sessionId: 's-2',
        userId: user.sub,
        role: 'USER',
        contentText: 'b',
        createdAt: new Date('2026-05-22T10:00:00Z'),
        widgets: null,
      },
      {
        sessionId: 's-3',
        userId: user.sub,
        role: 'USER',
        contentText: 'c',
        createdAt: new Date('2026-05-22T09:00:00Z'),
        widgets: null,
      },
    ]);
    const out = await service.listSessions(user, { limit: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.sessionId)).toEqual(['s-1', 's-2']);
  });

  it('listSessions devuelve array vacío si no hay mensajes', async () => {
    const { service, findManyMock } = buildService();
    findManyMock.mockResolvedValueOnce([]);
    const out = await service.listSessions(user, {});
    expect(out).toEqual([]);
  });

  it('listSessions propaga filtro userId al where de findMany', async () => {
    const { service, findManyMock } = buildService();
    findManyMock.mockResolvedValueOnce([]);
    await service.listSessions(user, { userId: 'op-1' });
    expect(findManyMock).toHaveBeenCalledOnce();
    expect(findManyMock.mock.calls[0]![0]!.where).toEqual({ userId: 'op-1' });
  });

  it('listSessions combina from/to en createdAt filter', async () => {
    const { service, findManyMock } = buildService();
    findManyMock.mockResolvedValueOnce([]);
    await service.listSessions(user, {
      from: '2026-05-20T00:00:00Z',
      to: '2026-05-23T00:00:00Z',
    });
    const where = findManyMock.mock.calls[0]![0]!.where;
    expect(where.createdAt.gte).toEqual(new Date('2026-05-20T00:00:00Z'));
    expect(where.createdAt.lt).toEqual(new Date('2026-05-23T00:00:00Z'));
  });

  it('listSessions cursor `before` se traduce a createdAt.lt', async () => {
    const { service, findManyMock } = buildService();
    findManyMock.mockResolvedValueOnce([]);
    await service.listSessions(user, { before: '2026-05-22T10:00:00Z' });
    const where = findManyMock.mock.calls[0]![0]!.where;
    expect(where.createdAt.lt).toEqual(new Date('2026-05-22T10:00:00Z'));
  });

  it('listSessions before + from/to combinan: lt gana frente a to', async () => {
    // Si el cliente pasa to=domingo y before=sábado, el resultado son
    // sólo sesiones de antes del sábado. (before sobrescribe lt).
    const { service, findManyMock } = buildService();
    findManyMock.mockResolvedValueOnce([]);
    await service.listSessions(user, {
      from: '2026-05-01T00:00:00Z',
      to: '2026-05-25T00:00:00Z',
      before: '2026-05-22T10:00:00Z',
    });
    const where = findManyMock.mock.calls[0]![0]!.where;
    expect(where.createdAt.gte).toEqual(new Date('2026-05-01T00:00:00Z'));
    expect(where.createdAt.lt).toEqual(new Date('2026-05-22T10:00:00Z'));
  });

  // ---------------------------------------------------------------------------
  // Sprint 13 — listSessionUsers (alimenta selector admin).
  // ---------------------------------------------------------------------------

  it('listSessionUsers join distinct userIds con users + fullName', async () => {
    const { service, groupByMock, userFindManyMock } = buildService();
    groupByMock.mockResolvedValueOnce([
      { userId: 'u-1', _count: { sessionId: 12 }, _max: { createdAt: new Date('2026-05-22T11:00:00Z') } },
      { userId: 'u-2', _count: { sessionId: 3 }, _max: { createdAt: new Date('2026-05-21T09:00:00Z') } },
    ]);
    userFindManyMock.mockResolvedValueOnce([
      { id: 'u-1', fullName: 'María Recepción', email: 'maria@hotel.test' },
      { id: 'u-2', fullName: null, email: 'lupita@hotel.test' },
    ]);
    const out = await service.listSessionUsers(user);
    expect(out).toEqual([
      {
        userId: 'u-1',
        fullName: 'María Recepción',
        email: 'maria@hotel.test',
        messageCount: 12,
        lastActivityAt: '2026-05-22T11:00:00.000Z',
      },
      {
        userId: 'u-2',
        fullName: null,
        email: 'lupita@hotel.test',
        messageCount: 3,
        lastActivityAt: '2026-05-21T09:00:00.000Z',
      },
    ]);
  });

  it('listSessionUsers devuelve [] cuando no hay mensajes', async () => {
    const { service, groupByMock } = buildService();
    groupByMock.mockResolvedValueOnce([]);
    const out = await service.listSessionUsers(user);
    expect(out).toEqual([]);
  });
});
