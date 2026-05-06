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

- W1 — scaffold + lista de tareas
- W2 — `/task/[id]` (start/complete) + cola offline IndexedDB (este commit)
- W3 — `/lost-found` con foto base64 + `/supervisor` (panel desktop)
- W4 — login QR + 4 tools MCP HSK
- W5 — UAT + RUNBOOK §13 + métricas Prometheus

## Cola offline (W2)

Las mutaciones (`/api/proxy/tasks/<id>/start|complete`) se ejecutan online
contra rutas internas que reenvían el Bearer del session a la API. Si
`navigator.onLine === false`, la mutación se persiste en IndexedDB
(`aubergine-hsk` / `mutations`) y se reintenta al volver la conexión
(`window.online` + intervalo de 30 s). Las respuestas 2xx y 409 (idempotente:
estado ya alcanzado) drenan la entrada; el resto incrementa `attempts` para
trazabilidad. La UI muestra un badge "Sin conexión" + contador de pendientes.
