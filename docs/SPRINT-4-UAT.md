# Sprint 4 — UAT (MVP Housekeeping)

> Checklist de UAT para staging antes del release. Toda la operativa del sprint cabe en una sesión de 60–90 min para una pareja supervisora + camarera, ejecutada con un dispositivo móvil real (no emulador).

## Pre-condiciones

- Staging desplegado: `apps/api` y `apps/web-hsk` con `NODE_ENV=production`.
- DB con migraciones de S4 W1, W3 y W4 aplicadas (`housekeeping_tasks`, `lost_found_items`, `device_pairings`).
- `PAIRING_SECRET` setado (>=32 chars). Si rota, los pairings emitidos antes dejan de validar — ejecutar UAT después de la rotación.
- En Keycloak realm `pms`:
  - Usuaria de QA con rol `housekeeping_supervisor`.
  - Usuaria de QA con rol `housekeeper`.
  - Mapper `tenant_id` aplicado a ambos clientes (`pms-web` y `pms-hsk`).
- Datos de prueba: 1 propiedad, 5 habitaciones (BCN01-101…105), al menos 1 huésped en `guests` para el flujo de claim.
- Dispositivo móvil de gama media + segundo navegador desktop (supervisor).

## Matriz de casos

| #   | Escenario                                                | Rol         | Pasos                                                                                                                                 | Resultado esperado                                                                                                                                          |
| --- | -------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Asignar tarea CHECKOUT_CLEAN**                         | supervisora | Login Keycloak → `/supervisor` → reasign control con UUID camarera en una tarea creada vía API o seed                                 | Tabla muestra "asignada" con los primeros 8 chars del user. `hsk_tasks_assigned_total` +1. Evento NATS `housekeeping.task_assigned`.                        |
| 2   | **Idempotencia de create**                               | supervisora | Llamar `POST /housekeeping/tasks` 2x con el mismo `(propertyId, businessDate, roomId, taskType)`                                      | Mismo `taskId` en ambas respuestas. Solo 1 evento `task_assigned`. `hsk_tasks_assigned_total` +1 (no +2).                                                   |
| 3   | **Login QR + start + complete**                          | sup → cam   | (a) sup `/supervisor/pair` mintea código (b) cam `/login/qr` redime (c) cam abre tarea, "Empezar" → "Finalizar" con room status CLEAN | Cookie `aubergine_pairing` HttpOnly establecida. Tarea pasa PENDING → IN_PROGRESS → COMPLETED. `room.status='CLEAN'`. `hsk_task_duration_minutes` recorded. |
| 4   | **Cola offline**                                         | cam         | Activar modo avión → "Empezar" en una tarea PENDING → desactivar avión                                                                | Badge "Sin conexión" mientras offline; al volver online, mutación drena en <30 s y la tarea aparece IN_PROGRESS. Pendientes vuelve a 0.                     |
| 5   | **Cancelar tarea**                                       | supervisora | `POST /housekeeping/tasks/:id/cancel {reason:"OOO"}` sobre una PENDING                                                                | Estado CANCELLED. `hsk_tasks_cancelled_total` +1. Re-cancelar devuelve 409.                                                                                 |
| 6   | **Lost & Found con foto**                                | cam         | `/lost-found` → form con foto del móvil → enviar                                                                                      | 200, item FOUND con `hasPhoto=true`. Payload < 800 kB tras resize a 1280 px. Lista lo muestra con badge "📷 con foto".                                      |
| 7   | **Lost & Found claim → dispose bloqueado**               | front_desk  | claim al item del caso 6 con un `guestId` válido → intentar dispose                                                                   | Claim 200, status=CLAIMED. Dispose 409 (state machine: solo desde FOUND).                                                                                   |
| 8   | **Pairing fallos**                                       | cam         | (a) redimir un código inexistente (b) redimir uno ya usado (c) redimir uno expirado (esperar 2 min) (d) redimir con tenantId ajeno    | (a) 404 + outcome=not_found (b) 409 + outcome=already (c) 401 + outcome=expired (d) 404 (RLS aísla). 4 incrementos en `hsk_pairings_redeemed_total`.        |
| 9   | **Reasignación re-emite evento**                         | supervisora | Reassign de PENDING a otro user                                                                                                       | Tarea actualizada. Otro evento `housekeeping.task_assigned` con el nuevo `assignedToUserId`.                                                                |
| 10  | **Métricas y panel**                                     | QA          | `curl :9464/metrics \| grep hsk_` tras los casos 1-9                                                                                  | Todas las series presentes con cardinalidad razonable (1 tenant, 1 property). Panel `/supervisor` muestra duración media coincidente con el caso 3.         |
| 11  | **Logout en pairing redirige a /login/qr (no Keycloak)** | cam         | Tras pairing, pulsar "Salir" en home                                                                                                  | Cookie borrada. Redirección a `/login/qr` (no a `/login`).                                                                                                  |
| 12  | **Sin offline, sin login QR — fallback Keycloak**        | cam         | Login normal en `/login` con un user que tenga rol `housekeeper`                                                                      | Funciona igual: `getApiToken()` cae a la sesión next-auth.                                                                                                  |

## Smoke automatizado

Script de smoke vía `curl` (ver §13 del RUNBOOK) cubre la ruta principal sin la PWA:

```bash
TOKEN=$(... keycloak token-exchange ...)
PROPERTY_ID=...
ROOM_ID=...
CAM_ID=...

TASK=$(curl -s -X POST $API_URL/housekeeping/tasks \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d "{\"propertyId\":\"$PROPERTY_ID\",\"roomId\":\"$ROOM_ID\",\"businessDate\":\"$(date +%F)\",\"taskType\":\"CHECKOUT_CLEAN\",\"assignedToUserId\":\"$CAM_ID\"}")
TASK_ID=$(echo $TASK | jq -r .id)

curl -s -X POST $API_URL/housekeeping/tasks/$TASK_ID/start -H "authorization: Bearer $TOKEN"
sleep 2
curl -s -X POST $API_URL/housekeeping/tasks/$TASK_ID/complete \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"resultingRoomStatus":"CLEAN"}'

curl -s "$API_URL/housekeeping/tasks/summary?propertyId=$PROPERTY_ID&businessDate=$(date +%F)" \
  -H "authorization: Bearer $TOKEN" | jq .
```

## Criterios de aceptación

- 12/12 casos pasan en una corrida sin reset.
- `:9464/metrics` muestra **todas** las series listadas con valor > 0.
- p95 de latencia E2E (start → complete vía PWA) < 800 ms en 4G simulado.
- Cero error logs `level>=error` en Pino durante la sesión salvo los esperados (caso 8).
- Después de borrar la cookie de pairing, la PWA redirige a `/login/qr` (no a `/login`).

## Issues conocidos / fuera de alcance W5

- Render del QR como imagen SVG inline en `/supervisor/pair`: pospuesto a S5; por ahora la camarera teclea o sigue el deep-link.
- Almacenamiento de fotos en S3 con URLs firmadas: V2. En MVP viven inline (`photoBase64`).
- MCP HSK tools NO están todavía conectadas al Copilot conversacional (ese cableado vive con el FO Copilot — se hace en S5/S6 con un router agnóstico).
