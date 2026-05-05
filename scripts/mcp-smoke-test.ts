/**
 * Smoke test del servidor MCP del PMS.
 *
 * Spawns scripts/mcp-server.ts, conecta como cliente MCP via stdio, lista
 * las tools y llama a get_tenant_info. Util para validar el ciclo completo
 * tras cambios en packages/mcp-tools/.
 *
 * Uso:
 *   pnpm mcp:test
 *
 * Requiere: docker compose arriba (Postgres) + DB con seed (tenant demo).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const envCandidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
for (const path of envCandidates) {
  if (existsSync(path)) {
    loadDotenv({ path });
    break;
  }
}

const TENANT_ID = process.env.MCP_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required (.env or env var)');
  process.exit(1);
}

async function main() {
  console.log(`→ Spawning MCP server (tenant=${TENANT_ID})`);

  const transport = new StdioClientTransport({
    command: 'tsx',
    args: [resolve(__dirname, 'mcp-server.ts')],
    env: {
      ...process.env,
      MCP_TENANT_ID: TENANT_ID,
      DATABASE_URL,
    } as Record<string, string>,
  });

  const client = new Client(
    { name: 'pms-mcp-smoke-test', version: '0.0.1' },
    { capabilities: {} },
  );

  await client.connect(transport);
  console.log('✓ connected');

  const tools = await client.listTools();
  console.log(`✓ tools/list returned ${tools.tools.length} tool(s):`);
  for (const t of tools.tools) {
    console.log(`    - ${t.name}: ${t.description}`);
  }

  const result = await client.callTool({ name: 'get_tenant_info', arguments: {} });
  console.log('✓ tools/call get_tenant_info →');
  for (const c of result.content as Array<{ type: string; text?: string }>) {
    if (c.type === 'text' && c.text) {
      console.log(c.text.split('\n').map((l) => `    ${l}`).join('\n'));
    }
  }
  if (result.isError) {
    console.error('✗ tool returned isError=true');
    process.exit(1);
  }

  await client.close();
  console.log('✓ smoke test passed');
}

main().catch((err) => {
  console.error('✗ smoke test failed:', err);
  process.exit(1);
});
