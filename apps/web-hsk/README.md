# @pms/web-hsk — Aubergine Housekeeping PWA

Next.js 15 + Tailwind 3, mobile-first, instalable como PWA.

UI para camareras y supervisores: ver tareas asignadas, marcar status,
reportar discrepancias, registrar Lost & Found. Sprint 4 W1 deja el scaffold
con login OIDC + lista de tareas; el detalle por habitación, la cola offline
y el panel del supervisor llegan en W2-W4.

## Desarrollo

```bash
pnpm install
pnpm --filter @pms/web-hsk dev    # http://localhost:3002
```

API por defecto en `http://localhost:3000` (configurable via
`NEXT_PUBLIC_API_URL`). Keycloak realm `pms`, client `pms-hsk` (separado del
`pms-web` que usa FO; mismo realm, scopes distintos).

## Restricción no negociable

Si no funciona fluido en un móvil de gama media con conexión 3G, no se
mergea.

## Roadmap

- W1 — scaffold + lista de tareas (este commit)
- W2 — `/room/[number]` (start/complete) + cola offline IndexedDB
- W3 — `/lost-found` con foto base64 + `/supervisor` (panel desktop)
- W4 — login QR + 4 tools MCP HSK
- W5 — UAT + RUNBOOK §13 + métricas Prometheus
