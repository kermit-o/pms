# @pms/mcp-tools

Definiciones de tools MCP (Model Context Protocol) que exponen las acciones del PMS a agentes de IA.

## Principio (ADR-002)

**Cada acción del PMS es una tool MCP-compatible desde el día 1.** Aunque el MVP exponga pocas, la arquitectura permite añadir agentes de IA en V2/V3 sin reescribir.

## Estructura prevista

```
src/
├── tools/
│   ├── reservations/      # create, modify, cancel, check-in, check-out
│   ├── folio/             # add-charge, post-payment, transfer
│   ├── housekeeping/      # set-room-status, assign-task, report-discrepancy
│   ├── night-audit/       # run, get-report, lock-day
│   └── reports/           # arrivals, departures, in-house, revenue
├── server.ts              # MCP server exposing tools over stdio/SSE
└── registry.ts            # central tool registry
```

Cada tool es un wrapper sobre los servicios del API con el mismo contrato de auth/RLS.
