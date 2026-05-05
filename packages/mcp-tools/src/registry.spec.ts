import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from './registry';
import type { McpContext } from './types';

const ctx: McpContext = { tenantId: 't1', actorId: null, correlationId: null };

describe('ToolRegistry', () => {
  it('registers a tool and exposes it via list() with JSON Schema', () => {
    const r = new ToolRegistry();
    r.register({
      name: 'add',
      description: 'sum two numbers',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      handler: async ({ a, b }) => a + b,
    });
    const list = r.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('add');
    expect(list[0]?.description).toBe('sum two numbers');
    expect(list[0]?.inputSchema).toMatchObject({ type: 'object' });
  });

  it('rejects duplicate registration', () => {
    const r = new ToolRegistry();
    const tool = {
      name: 'x',
      description: 'd',
      inputSchema: z.object({}),
      handler: async () => null,
    };
    r.register(tool);
    expect(() => r.register(tool)).toThrow(/already registered/);
  });

  it('validates input via Zod and invokes the handler', async () => {
    const r = new ToolRegistry();
    const handler = vi.fn(async ({ name }: { name: string }) => `hi ${name}`);
    r.register({
      name: 'greet',
      description: 'say hi',
      inputSchema: z.object({ name: z.string() }),
      handler,
    });
    const result = await r.invoke('greet', { name: 'world' }, ctx);
    expect(result).toBe('hi world');
    expect(handler).toHaveBeenCalledWith({ name: 'world' }, ctx);
  });

  it('rejects invalid input before invoking handler', async () => {
    const r = new ToolRegistry();
    const handler = vi.fn();
    r.register({
      name: 'greet',
      description: 'say hi',
      inputSchema: z.object({ name: z.string() }),
      handler,
    });
    await expect(r.invoke('greet', { name: 42 }, ctx)).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('throws on unknown tool', async () => {
    const r = new ToolRegistry();
    await expect(r.invoke('nonexistent', {}, ctx)).rejects.toThrow(/Unknown tool/);
  });

  it('coerces missing input to empty object', async () => {
    const r = new ToolRegistry();
    r.register({
      name: 'noop',
      description: '',
      inputSchema: z.object({}),
      handler: async () => 'ok',
    });
    expect(await r.invoke('noop', undefined, ctx)).toBe('ok');
  });
});
