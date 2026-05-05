import type { z } from 'zod';

/**
 * Contexto que recibe el handler de cada tool. Lo provee el transport
 * cuando el tool se invoca:
 *   - stdio (Sprint 1): tenant fijado al arrancar el server desde env.
 *   - HTTP/SSE (Sprint 2): tenant extraido del JWT del request.
 */
export interface McpContext {
  tenantId: string;
  actorId: string | null;
  correlationId: string | null;
}

/**
 * Definicion de una tool MCP. El input se valida con Zod antes de invocar
 * el handler; el output es lo que se serializa de vuelta al cliente.
 *
 * Patron de uso:
 *
 *   registry.register({
 *     name: 'get_tenant_info',
 *     description: '...',
 *     inputSchema: z.object({}),
 *     handler: async (input, ctx) => { ... }
 *   });
 */
export interface ToolDefinition<TInput extends z.ZodTypeAny = z.ZodTypeAny, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: TInput;
  handler: (input: z.infer<TInput>, ctx: McpContext) => Promise<TOutput>;
}
