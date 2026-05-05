import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ToolRegistry } from './registry';
import type { McpContext } from './types';

export const SERVER_NAME = 'pms-mcp';
export const SERVER_VERSION = '0.0.1';

/**
 * Adapter de ToolRegistry → MCP SDK Server. Sin transport (stdio/HTTP/etc.)
 * para que el caller decida como exponerlo.
 *
 * El ctx se fija al crear el server (Sprint 1 stdio: tenant unico por
 * proceso). En Sprint 2 cuando expongamos HTTP/SSE el ctx vendra del JWT
 * de cada request y reemplazaremos esto por una factory por-conexion.
 */
export function createMcpServer(registry: ToolRegistry, ctx: McpContext): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.list(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await registry.invoke(req.params.name, req.params.arguments ?? {}, ctx);
      return {
        content: [
          {
            type: 'text' as const,
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startStdioServer(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
