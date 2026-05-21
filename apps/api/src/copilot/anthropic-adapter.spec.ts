import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AnthropicAdapter } from './anthropic-adapter';
import type { CopilotSessionState } from './copilot.types';
import type { AuthUser } from '../auth';

const user: AuthUser = {
  sub: '22222222-2222-2222-2222-222222222222',
  tenantId: '11111111-1111-1111-1111-111111111111',
  email: 'desk@hotel.test',
  roles: ['front_desk'],
};

const session: CopilotSessionState = {
  id: '33333333-3333-3333-3333-333333333333',
  tenantId: user.tenantId,
  userId: user.sub,
  propertyId: '44444444-4444-4444-4444-444444444444',
  messages: [{ role: 'user', content: 'qué tareas tengo hoy' }],
};

// Mock global del SDK Anthropic — verificamos que el adapter monta
// correctamente el request y procesa el response.
const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    beta: { messages: { create: createMock } },
  })),
}));

function buildAdapter() {
  const resolver = {
    has: vi.fn().mockReturnValue(true),
    getMeta: vi.fn().mockReturnValue({ name: 'x', description: 'x', mutating: false, financial: false }),
    execute: vi.fn().mockResolvedValue({ ok: true }),
    tryValidate: vi.fn().mockReturnValue({ ok: true }),
  };
  const config = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'ANTHROPIC_API_KEY') return 'sk-ant-test';
      if (key === 'COPILOT_MODEL') return 'claude-sonnet-4-6';
      return undefined;
    }),
  };
  return { adapter: new AnthropicAdapter(resolver as never, config as never), resolver };
}

describe('AnthropicAdapter', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('isAvailable returns true when API key is set', () => {
    const { adapter } = buildAdapter();
    expect(adapter.isAvailable()).toBe(true);
  });

  it('marks the system prompt with cache_control ephemeral', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'hola' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const { adapter } = buildAdapter();
    await adapter.propose(session, user, 'cid', 'qué tareas tengo hoy');
    const call = createMock.mock.calls[0]![0];
    expect(call.system).toEqual([
      expect.objectContaining({
        type: 'text',
        cache_control: { type: 'ephemeral' },
      }),
    ]);
  });

  it('marks the last tool with cache_control ephemeral', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'hola' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const { adapter } = buildAdapter();
    await adapter.propose(session, user, 'cid', 'm');
    const tools = createMock.mock.calls[0]![0].tools as Array<{
      name: string;
      cache_control?: unknown;
    }>;
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[tools.length - 1]!.cache_control).toEqual({ type: 'ephemeral' });
    // Los tools no-ultimos NO deben tener cache_control.
    expect(tools[0]!.cache_control).toBeUndefined();
  });

  it('returns telemetry with tokens and latency from usage', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'hola' }],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 300,
      },
    });
    const { adapter } = buildAdapter();
    const result = await adapter.propose(session, user, 'cid', 'm');
    expect(result.telemetry).toEqual({
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 200,
      cacheWriteTokens: 300,
      latencyMs: expect.any(Number),
    });
  });

  it('invokes onToolUse and onToolResult callbacks for read-only tools', async () => {
    createMock
      .mockResolvedValueOnce({
        content: [
          { type: 'tool_use', id: 't1', name: 'hsk_list_today', input: { propertyId: 'p' } },
        ],
        usage: { input_tokens: 5, output_tokens: 5 },
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'resultado final' }],
        usage: { input_tokens: 5, output_tokens: 5 },
      });
    const { adapter } = buildAdapter();
    const onToolUse = vi.fn();
    const onToolResult = vi.fn();
    await adapter.propose(session, user, 'cid', 'm', { onToolUse, onToolResult });
    expect(onToolUse).toHaveBeenCalledWith('hsk_list_today');
    expect(onToolResult).toHaveBeenCalledWith('hsk_list_today', true);
  });

  it('throws when called without API key', async () => {
    const resolver = { has: vi.fn(), getMeta: vi.fn(), execute: vi.fn(), tryValidate: vi.fn() };
    const config = { get: vi.fn().mockReturnValue(undefined) };
    const adapter = new AnthropicAdapter(resolver as never, config as never);
    expect(adapter.isAvailable()).toBe(false);
    await expect(adapter.propose(session, user, 'cid', 'm')).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  // ---------------------------------------------------------------------------
  // Sprint 13 W4 — widgets estructurados (Mockup B, first slice).
  // ---------------------------------------------------------------------------

  it('emite un widget de disponibilidad cuando el LLM ejecuta search_availability_by_type', async () => {
    const availabilityResult = [
      {
        roomTypeId: 'rt-dbl',
        code: 'DBL',
        name: 'Doble Estándar',
        description: null,
        baseOccupancy: 2,
        maxOccupancy: 2,
        totalRooms: 12,
        availableRooms: 8,
        pricePerNight: '95',
        totalForStay: '95',
        nights: 1,
        defaultCurrency: 'EUR',
      },
    ];
    createMock
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'search_availability_by_type',
            input: { propertyId: 'p', arrival: '2026-05-26', departure: '2026-05-27', adults: 2 },
          },
        ],
        usage: { input_tokens: 5, output_tokens: 5 },
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Hay 1 tipo disponible.' }],
        usage: { input_tokens: 5, output_tokens: 5 },
      });
    const { adapter, resolver } = buildAdapter();
    resolver.execute.mockResolvedValueOnce(availabilityResult);
    const out = await adapter.propose(session, user, 'cid', 'precios');
    expect(out.proposal.kind).toBe('text');
    if (out.proposal.kind === 'text') {
      expect(out.proposal.widgets).toBeDefined();
      expect(out.proposal.widgets).toHaveLength(1);
      expect(out.proposal.widgets![0]!.kind).toBe('availability');
      // El widget contiene el precio EXACTO del tool, no del LLM.
      const widget = out.proposal.widgets![0]!;
      if (widget.kind === 'availability') {
        expect(widget.data.rows[0]!.pricePerNight).toBe('95');
        expect(widget.data.rows[0]!.available).toBe(8);
      }
    }
  });

  it('no añade widgets cuando no se ejecutó ningún tool con widget asociado', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Sin tool calls.' }],
      usage: { input_tokens: 5, output_tokens: 5 },
    });
    const { adapter } = buildAdapter();
    const out = await adapter.propose(session, user, 'cid', 'hola');
    if (out.proposal.kind === 'text') {
      expect(out.proposal.widgets).toBeUndefined();
    }
  });
});
