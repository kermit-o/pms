# @pms/mcp-tools

MCP (Model Context Protocol) tools del PMS. Expone acciones del dominio como
tools consumibles por agentes de IA (Claude Desktop, agentes custom, MCP-aware
LLMs).

## Por qué MCP

Per ADR-002 del proyecto: **cada acción del PMS debe ser una tool MCP-compatible
desde el día 1**. Aunque en MVP el set de tools sea pequeño, la arquitectura
permite añadir agentes en V2/V3 sin reescribir nada — ese es el moat frente a
PMS legacy.

## Arquitectura

```
                    ┌──────────────┐
                    │ Claude / IA  │
                    └───────┬──────┘
                            │ MCP protocol (stdio o HTTP/SSE)
                    ┌───────▼──────┐
                    │  MCP Server  │  (Sprint 1: stdio, tenant fijo en env)
                    └───────┬──────┘  (Sprint 2: HTTP/SSE, tenant del JWT)
                            │
                    ┌───────▼──────┐
                    │ ToolRegistry │  ← este paquete
                    └───────┬──────┘
                            │
                ┌───────────┼───────────┐
                │           │           │
        get_tenant_info   ...         ... (cada accion del PMS)
                │
                └─→ withTenant() → RLS → Postgres
```

## Estructura

```
src/
├── types.ts                # McpContext, ToolDefinition
├── registry.ts             # ToolRegistry (register, list, invoke con Zod)
├── server.ts               # Adapter registry → SDK Server (transport-agnostic)
└── tools/
    └── get-tenant-info.ts  # Tool de ejemplo
```

## Uso desde script (stdio)

`scripts/mcp-server.ts` arranca un servidor MCP por stdin/stdout con el
tenant fijado por env:

```bash
MCP_TENANT_ID=11111111-1111-1111-1111-111111111111 \
  pnpm mcp:server
```

## Conectar Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) o
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "pms": {
      "command": "tsx",
      "args": ["/workspaces/pms/scripts/mcp-server.ts"],
      "env": {
        "DATABASE_URL": "postgresql://pms_app:pms_app_dev_password@localhost:5432/pms",
        "MCP_TENANT_ID": "11111111-1111-1111-1111-111111111111"
      }
    }
  }
}
```

Reinicia Claude Desktop. La tool `get_tenant_info` aparecerá disponible.

## Añadir una tool nueva

1. Crear `src/tools/<nombre>.ts` con un factory `makeXTool(...deps): ToolDefinition`.
2. Registrarlo en `scripts/mcp-server.ts`.
3. Listo: el handler recibe input ya validado por Zod y un `McpContext`
   (tenant + actor + correlation) que pasa directo a `prisma.withTenant()`.

## Pendiente (Sprint 2+)

- HTTP/SSE transport montado como sub-app de NestJS en `/mcp` con auth JWT.
- Tools de FO: `create_reservation`, `check_in_guest`, `post_charge`, etc.
- Tools de NA: `run_night_audit`, `get_arrivals_report`.
- Tools de HSK: `set_room_status`, `assign_housekeeping_task`.
