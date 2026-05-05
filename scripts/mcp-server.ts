/**
 * Servidor MCP del PMS por stdio.
 *
 * Sprint 1 / single-tenant: el tenant_id es fijo durante la vida del proceso
 * (viene de MCP_TENANT_ID en env). Ideal para integracion con Claude Desktop
 * en dev/single-property.
 *
 * Sprint 2 / multi-tenant: se montara HTTP/SSE como sub-app de NestJS y el
 * tenant vendra del JWT por request.
 *
 * IMPORTANTE: la transport stdio usa stdout para el protocolo. NUNCA usar
 * console.log aqui — solo console.error (que va a stderr). Si necesitas
 * debug log, escribelo a stderr o a un fichero.
 *
 * Uso:
 *   MCP_TENANT_ID=11111111-... pnpm mcp:server
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  ToolRegistry,
  createMcpServer,
  startStdioServer,
  makeGetTenantInfoTool,
} from '@pms/mcp-tools';

// Carga .env de la raiz del monorepo (silencioso — usa stderr para warnings).
const envCandidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
for (const path of envCandidates) {
  if (existsSync(path)) {
    loadDotenv({ path });
    break;
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const tenantId = process.env.MCP_TENANT_ID;
if (!tenantId) {
  console.error('MCP_TENANT_ID is required (UUID of the tenant this MCP session represents)');
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const registry = new ToolRegistry().register(makeGetTenantInfoTool(prisma));

const server = createMcpServer(registry, {
  tenantId,
  // Para audit log: el actor es el cliente MCP. Usamos un UUID derminista
  // 'mcp-stdio' no encaja en uuid format, asi que lo dejamos null en Sprint 1
  // (el audit log permite actorId nullable).
  actorId: null,
  correlationId: null,
});

startStdioServer(server).catch((err) => {
  console.error('MCP server error:', err);
  prisma.$disconnect().finally(() => process.exit(1));
});

const shutdown = async () => {
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.error(`pms-mcp stdio server started (tenant=${tenantId}, ${registry.size()} tools)`);
