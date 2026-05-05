import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { McpContext, ToolDefinition } from './types';

export interface ListedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Registry de tools. Es un componente puro — no depende del transport (stdio
 * o HTTP). El server adapter consume este registry.
 *
 * El input de cada invoke se valida con Zod ANTES de pasarselo al handler:
 * los handlers pueden asumir input ya tipado y limpio.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register<I extends z.ZodTypeAny, O>(tool: ToolDefinition<I, O>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as unknown as ToolDefinition);
    return this;
  }

  list(): ListedTool[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema, { target: 'jsonSchema7' }) as Record<
        string,
        unknown
      >,
    }));
  }

  async invoke(name: string, input: unknown, ctx: McpContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    const validated = tool.inputSchema.parse(input ?? {});
    return tool.handler(validated, ctx);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  size(): number {
    return this.tools.size;
  }
}
