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
});
