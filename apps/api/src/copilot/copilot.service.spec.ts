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
  };
  const config = {
    get: vi.fn().mockReturnValue(undefined),
  };
  const service = new CopilotService(resolver as never, config as never);
  return { service, resolver };
}

describe('CopilotService', () => {
  it('opens a session scoped to the user tenant', () => {
    const { service } = buildService();
    const out = service.createSession(user, PROPERTY_ID);
    expect(out.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const view = service.getSession(user, out.sessionId);
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

  it('rejects sessions that belong to another tenant', () => {
    const { service } = buildService();
    const { sessionId } = service.createSession(user, undefined);
    const otherUser: AuthUser = {
      sub: USER_ID,
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      email: 'other@example.com',
      roles: ['front_desk'],
    };
    expect(() => service.getSession(otherUser, sessionId)).toThrow();
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
});
