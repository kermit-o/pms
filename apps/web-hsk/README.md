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
- W2 — `/task/[id]` (start/complete) + cola offline IndexedDB
- W3 — `/lost-found` con foto base64 + `/supervisor` (panel desktop)
- W4 — login QR + 4 tools MCP HSK (este commit)
- W5 — UAT + RUNBOOK §13 + métricas Prometheus

## Login QR (W4)

Para móviles compartidos: el supervisor entra en `/supervisor/pair`,
introduce el `userId` de la camarera y obtiene un código de 12 caracteres
(TTL 2 min, configurable via `PAIRING_CODE_TTL_SECONDS`). La camarera abre
`/login/qr` (deep-linkable con `?tenantId=X&code=Y`) y lo redime, recibiendo
un JWT HMAC HS256 (`iss=aubergine-pairing`, TTL 12 h, configurable via
`PAIRING_TOKEN_TTL_HOURS`) que se almacena en una cookie HttpOnly. El
`JwtValidatorService` de la API acepta este segundo issuer en paralelo a
Keycloak. El `getApiToken()` del backend Next prefiere la cookie cuando
existe, así una camarera puede operar sin pasar por Keycloak.

`PAIRING_SECRET` (>=32 chars) es obligatorio en producción; en dev se
autogenera por proceso (los pairings no sobreviven a un reinicio).

## MCP HSK tools (W4)

`packages/mcp-tools/src/catalog/hsk.ts` define 4 tools:
`hsk_assign_task`, `hsk_start_task`, `hsk_complete_task` (mutating, no
financial) y `hsk_list_today` (read-only). El router está en
`apps/api/src/housekeeping/hsk-tool-router.ts` y delega en
`HousekeepingTasksService`. Igual que los FO tools, las mutating requieren
confirmación humana cuando se invocan desde un copilot conversacional.

## Lost & Found (W3)

`/lost-found?propertyId=<uuid>`. La cámara captura una imagen, se redimensiona
a `1280` px en un canvas (calidad JPEG 0.7) y se envía como `data:image/jpeg`
a la API. Si en el futuro las fotos pasan a S3 (V2), el contrato de la API
no cambia: `photoBase64` deja de almacenarse y aparece un `photoUrl` firmado.

## Panel supervisor (W3)

`/supervisor?propertyId=<uuid>&date=YYYY-MM-DD` (desktop, max-w-6xl). Muestra
KPIs del día (total / en curso / completadas / duración media), agregaciones
por camarera (total/completed/%) y la tabla de tareas con un control inline
de reasignación (input UUID + Enter). El reassign emite `task_assigned` de
nuevo para que el timeline lo registre.

## Cola offline (W2)

Las mutaciones (`/api/proxy/tasks/<id>/start|complete`) se ejecutan online
contra rutas internas que reenvían el Bearer del session a la API. Si
`navigator.onLine === false`, la mutación se persiste en IndexedDB
(`aubergine-hsk` / `mutations`) y se reintenta al volver la conexión
(`window.online` + intervalo de 30 s). Las respuestas 2xx y 409 (idempotente:
estado ya alcanzado) drenan la entrada; el resto incrementa `attempts` para
trazabilidad. La UI muestra un badge "Sin conexión" + contador de pendientes.
