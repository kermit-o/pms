# PMS — Operational RUNBOOK

Guía operativa: cómo levantar el sistema desde cero, cómo resetearlo, dónde
buscar logs/métricas, y qué hacer cuando algo se rompe.

> Para arquitectura, alcance y roadmap → ver [`PROJECT.md`](./PROJECT.md).

---

## 1. Levantar todo de cero (máquina nueva)

Pre-requisitos: Docker + Node 20 + pnpm 9.

```bash
git clone <repo>
cd pms

# 1. Variables de entorno
cp .env.example .env

# 2. Instalar dependencias
pnpm install

# 3. Generar Prisma Client
pnpm --filter @pms/db generate

# 4. Levantar infra local (Postgres, Redis, NATS, Keycloak, Mailhog)
pnpm infra:up

# 5. Aplicar migraciones (espera ~10s a que Postgres esté ready)
pnpm --filter @pms/db migrate:deploy

# 6. Seed de datos demo (tenant + property + admin user)
pnpm --filter @pms/db seed

# 7. Bootstrap de Keycloak (espera ~20-30s a que Keycloak esté ready)
pnpm bootstrap:keycloak

# 8. Arrancar el API
pnpm --filter @pms/api dev
```

API en `http://localhost:3000`. Métricas Prometheus en `http://localhost:9464/metrics`.

## 2. Smoke test end-to-end

Verifica que la cadena `JWT firmado → tenant_id → withTenant → RLS` funciona:

```bash
# Token desde Keycloak
TOKEN=$(curl -s -X POST "http://localhost:8080/realms/pms/protocol/openid-connect/token" \
  -d "client_id=pms-api" -d "client_secret=pms-api-dev-secret" \
  -d "username=admin@demo.local" -d "password=demo123" \
  -d "grant_type=password" | jq -r .access_token)

# /me debe devolver tenantId, roles
curl -s http://localhost:3000/me -H "Authorization: Bearer $TOKEN" | jq

# /properties debe devolver SOLO la BCN01 (RLS aislando)
curl -s http://localhost:3000/properties -H "Authorization: Bearer $TOKEN" | jq

# MCP server smoke test
pnpm mcp:test
```

## 3. Reset completo

Si algo está corrupto (Keycloak, DB, NATS), parte de cero:

```bash
# Tira y borra TODO (volúmenes Docker)
pnpm infra:reset

# Re-bootstrap
pnpm --filter @pms/db generate
pnpm --filter @pms/db migrate:deploy
pnpm --filter @pms/db seed
pnpm bootstrap:keycloak
```

## 4. Reset solo de la base de datos

```bash
pnpm --filter @pms/db migrate:reset   # drop schema + re-apply migrations
pnpm --filter @pms/db seed
```

## 5. Tests

```bash
# Unit (no requieren infra)
pnpm test

# Integration (requieren docker compose arriba)
pnpm --filter @pms/db test:integration       # 8 tests de RLS
pnpm --filter @pms/eventbus test:integration # 2 tests round-trip NATS

# E2E del API (mock de Prisma + NATS, no requiere infra)
pnpm --filter @pms/api test:e2e

# Smoke test del MCP server (requiere infra + DB con seed)
pnpm mcp:test
```

## 6. Logs

```bash
# Logs del API en dev (ya están en consola si pnpm dev está corriendo)
# Cada log incluye trace_id/span_id si OTel detectó un span activo

# Logs de infra
pnpm infra:logs                 # tail de todos los servicios
docker logs -f pms-postgres
docker logs -f pms-keycloak
docker logs -f pms-nats
```

## 7. Inspección de datos

```bash
# Postgres
docker exec -it pms-postgres psql -U pms -d pms
# Ejemplos útiles:
#   \dt                        # listar tablas
#   SELECT * FROM tenants;
#   SELECT * FROM audit_log ORDER BY changed_at DESC LIMIT 10;

# Prisma Studio (UI)
pnpm --filter @pms/db studio   # abre http://localhost:5555

# NATS — monitor HTTP
curl -s http://localhost:8222/jsz | jq
curl -s http://localhost:8222/streamz | jq

# Keycloak — admin UI
open http://localhost:8080
# admin / admin_dev_password
```

## 8. Métricas y trazas

```bash
# Prometheus metrics
curl -s http://localhost:9464/metrics

# Jaeger (opcional — habilita trazas visualizables)
docker run -d --name jaeger \
  -p 16686:16686 -p 4318:4318 \
  jaegertracing/all-in-one:latest

# Y en .env:
echo 'OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318' >> .env
# Reinicia el API. UI: http://localhost:16686
```

## 9. Troubleshooting

### "Cannot find module 'fastify'" o similar

- Olvidaste `pnpm install` tras un pull. Ejecuta y reintenta.

### "type 'citext' does not exist" al hacer migrate:reset

- Las extensiones se crean en la migración inicial — debería estar arreglado.
  Si vuelve: `pnpm infra:reset` rehace los volúmenes desde init scripts.

### "Token missing tenant_id claim"

- El protocol mapper no está activo en Keycloak. Re-ejecuta `pnpm bootstrap:keycloak`.
- Verifica que el atributo `tenant_id` está en el usuario:
  ```bash
  ADMIN_TOKEN=$(curl -s -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
    -d "grant_type=password" -d "client_id=admin-cli" \
    -d "username=admin" -d "password=admin_dev_password" | jq -r .access_token)
  curl -s "http://localhost:8080/admin/realms/pms/users?email=admin@demo.local" \
    -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.[0].attributes'
  ```

### "permission denied for schema public" al migrate:deploy

- `DIRECT_URL` no está en `.env` o apunta al rol `pms_app` (que no es owner).
  Debe apuntar al rol `pms` (superuser): ver `.env.example`.

### `/readyz` devuelve 503

- Mira `checks` en la respuesta para ver qué subsistema falla (db / nats).
- Para DB: `docker ps | grep postgres` y `docker logs pms-postgres`.
- Para NATS: `curl http://localhost:8222/healthz`.

### Puerto 3000 ocupado tras Ctrl+C

```bash
pkill -f "ts-node-dev" 2>/dev/null
lsof -ti:3000 | xargs -r kill -9
```

### `pnpm install` se queja de lockfile incompatible

- `pnpm install --no-frozen-lockfile` para regenerarlo en local.
  Asegúrate de committearlo si es legítimo el cambio.

## 10. Tareas comunes de desarrollo

```bash
# Aplicar Prettier a todo
pnpm format

# Lint + typecheck + test antes de commit
pnpm lint && pnpm typecheck && pnpm test

# Ver el grafo de tasks de Turbo
pnpm exec turbo run build --graph

# Una nueva migración tras cambiar schema.prisma
pnpm --filter @pms/db migrate:dev --name <descripcion>
```

## 11. Flujo de trabajo Git

- Branch de desarrollo: `claude/plan-hotel-saas-rWaWw` (ver §11 PROJECT.md).
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
- PRs a `main` con CI verde.
- No mergear sin que pasen format + lint + typecheck + test + build.

---

## 12. Despliegue a Railway (staging)

Esta sección documenta el setup actual de staging y los gotchas reales que
encontramos al desplegar. Si vas a desplegar de cero o a debugear staging,
empieza aquí.

### 12.1 Arquitectura

```
Railway project pms-staging:
├── postgres-app          managed Postgres (DB de la app)
├── postgres-keycloak     managed Postgres dedicado a Keycloak
├── nats                  servicio Docker (nats:2.10-alpine)
├── redis                 managed Redis
├── keycloak              servicio Docker (quay.io/keycloak/keycloak:25.0)
└── api                   GitHub repo build con Dockerfile
```

Cada servicio expone únicamente lo que necesita públicamente — el resto se
comunican por el dominio privado (`*.railway.internal`) sin TLS.

### 12.2 Bootstrap inicial (orden recomendado)

1. **+ New Project** → **Empty Project**.
2. **+ Add** → **Database** → **PostgreSQL** → renombra a `postgres-app`.
3. **+ Add** → **Database** → **PostgreSQL** → renombra a `postgres-keycloak`.
4. **+ Add** → **Database** → **Redis** → renombra a `redis`.
5. **+ Add** → **Docker Image** → `nats:2.10-alpine` → renombra a `nats`.
   - Settings → Deploy → Custom Start Command:
     `nats-server -js -m 8222 --store_dir /data`.
6. **+ Add** → **Docker Image** → `quay.io/keycloak/keycloak:25.0` → renombra a `keycloak`.
   - Settings → Deploy → Custom Start Command:
     `/opt/keycloak/bin/kc.sh start-dev` (ver Gotcha 1).
   - Settings → Networking → **Generate Domain**.
   - Variables (RAW Editor):

     ```
     KC_DB=postgres
     KC_DB_URL=jdbc:postgresql://${{postgres-keycloak.RAILWAY_PRIVATE_DOMAIN}}:5432/${{postgres-keycloak.PGDATABASE}}
     KC_DB_USERNAME=${{postgres-keycloak.PGUSER}}
     KC_DB_PASSWORD=${{postgres-keycloak.PGPASSWORD}}
     KC_HOSTNAME=https://${{RAILWAY_PUBLIC_DOMAIN}}
     KC_HOSTNAME_STRICT=false
     KC_HTTP_ENABLED=true
     KC_HTTP_PORT=8080
     KC_PROXY_HEADERS=xforwarded
     KEYCLOAK_ADMIN=admin
     KEYCLOAK_ADMIN_PASSWORD=ChangeMeStaging2026!
     ```

7. **+ Add** → **GitHub Repo** → `kermit-o/pms` (rama `main`) → renombra a `api`.
   - Railway autodetecta el `Dockerfile` de la raíz y construye.
   - Settings → Networking → **Generate Domain**.
   - Variables (RAW Editor):

     ```
     NODE_ENV=production
     LOG_LEVEL=info
     APP_HOST=0.0.0.0
     DATABASE_URL=${{postgres-app.DATABASE_URL}}
     DIRECT_URL=${{postgres-app.DATABASE_URL}}
     REDIS_URL=${{redis.REDIS_URL}}
     NATS_URL=nats://${{nats.RAILWAY_PRIVATE_DOMAIN}}:4222
     KEYCLOAK_URL=https://${{keycloak.RAILWAY_PUBLIC_DOMAIN}}
     KEYCLOAK_REALM=pms
     KEYCLOAK_CLIENT_ID=pms-api
     OTEL_ENABLED=true
     OTEL_METRICS_PORT=9464
     ```

   - Tras el primer build (~5-8 min) `/healthz` debería responder 200.

### 12.3 Bootstrap del realm Keycloak (desde Codespace)

Idempotente — re-ejecutable las veces que haga falta. Crea/actualiza realm
`pms`, client `pms-api`, mapper `tenant_id`, roles y usuario demo.

```bash
KEYCLOAK_URL=https://<tu-dominio-keycloak>.up.railway.app \
KEYCLOAK_ADMIN=admin \
KEYCLOAK_ADMIN_PASSWORD=ChangeMeStaging2026! \
  pnpm bootstrap:keycloak
```

### 12.4 Seed contra Postgres de staging

Necesitas el TCP proxy público de `postgres-app`:

- Railway → `postgres-app` → Variables → revela el valor de `DATABASE_PUBLIC_URL`.
- O: Settings → Networking → "Generate TCP Proxy Domain".

Luego desde el Codespace:

```bash
# Bypass del wrapper dotenv-cli (ver Gotcha 7) corriendo tsx directamente:
DATABASE_URL='postgresql://postgres:<pwd>@<host>.proxy.rlwy.net:<port>/railway' \
DIRECT_URL='postgresql://postgres:<pwd>@<host>.proxy.rlwy.net:<port>/railway' \
  pnpm --filter @pms/db exec tsx prisma/seed.ts
```

### 12.5 Smoke test E2E real

```bash
KEYCLOAK_URL=https://<tu-dominio-keycloak>.up.railway.app
API_URL=https://<tu-dominio-api>.up.railway.app

TOKEN=$(curl -s -X POST "$KEYCLOAK_URL/realms/pms/protocol/openid-connect/token" \
  -d "client_id=pms-api" -d "client_secret=pms-api-dev-secret" \
  -d "username=admin@demo.local" -d "password=demo123" \
  -d "grant_type=password" | jq -r .access_token)

# Verifica que el JWT lleva tenant_id
echo $TOKEN | cut -d. -f2 | base64 -d 2>/dev/null | jq .tenant_id
# → "11111111-1111-1111-1111-111111111111"

curl -s "$API_URL/healthz" | jq
curl -s "$API_URL/readyz" | jq    # checks: { db: ok, nats: ok }
curl -s "$API_URL/me" -H "Authorization: Bearer $TOKEN" | jq
curl -s "$API_URL/properties" -H "Authorization: Bearer $TOKEN" | jq
# → array con la BCN01 (RLS filtró por tenantId del token)
```

Si `/properties` devuelve solo el property del tenant demo, **el flujo
JWT firmado → tenant_id claim → withTenant() → RLS → resultado filtrado
está validado end-to-end**.

### 12.6 Gotchas reales (lecciones aprendidas en el primer despliegue)

| #   | Síntoma                                                                                             | Causa                                                                                                                        | Fix                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Keycloak crash: `The executable 'start-dev' could not be found`                                     | "Custom Start Command" de Railway **reemplaza ENTRYPOINT**, no se concatena con él                                           | Usar path absoluto: `/opt/keycloak/bin/kc.sh start-dev`                                                                                             |
| 2   | Keycloak crash: `Driver does not support the provided URL: postgresql://...`                        | Keycloak espera **JDBC URL con prefijo `jdbc:`**, no la `DATABASE_URL` postgresql:// estándar                                | `KC_DB_URL=jdbc:postgresql://${{...}}:5432/${{...}}`                                                                                                |
| 3   | Keycloak guarda atributos del usuario pero no aparecen como claim en el JWT                         | Keycloak 24+ tiene **User Profile activo** que elimina silenciosamente atributos no declarados                               | El bootstrap script setea `unmanagedAttributePolicy: ENABLED` en el realm vía PUT `/users/profile` (ya hecho — solo verificar tras re-deploy)       |
| 4   | API crash: `Prisma Client could not locate the Query Engine for runtime "linux-musl-openssl-3.0.x"` | Cuando se instala `openssl` (3.x) en Alpine runtime, Prisma necesita un binario distinto al `linux-musl` (1.x)               | Añadir `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` al generator de `schema.prisma`                                                     |
| 5   | API crash: `Cannot find module '@opentelemetry/sdk-node'`                                           | Multi-stage Docker copiaba solo `apps/api/dist` y `node_modules` raíz; faltaban los symlinks pnpm de `apps/api/node_modules` | `COPY --from=build /app /app` — copia el workspace entero al runtime                                                                                |
| 6   | API crash: `SyntaxError: Unexpected token 'export'` apuntando a `packages/db/src/index.ts`          | `main` apuntaba a `./src/index.ts` (TypeScript). En dev (ts-node-dev/tsx) funciona; con `node` puro no                       | Compilar workspace packages a `dist/` con `tsc -p tsconfig.build.json`. `main` → `./dist/index.js`. `predev` en api los construye antes de levantar |
| 7   | API arranca pero Railway devuelve 502 `Application failed to respond`                               | App escucha en `APP_PORT=3000` (var fija) pero Railway routea al puerto que inyecta vía `process.env.PORT`                   | En `main.ts`: `const port = Number(process.env.PORT) \|\| config.get('APP_PORT')`                                                                   |
| ★   | Migración Prisma falla con `role pms_app does not exist` en Postgres managed                        | El init script `infra/postgres/init/02-roles.sql` solo corre en docker-compose local, no en Railway/Fly                      | Migración inicial crea `pms_app` con `CREATE ROLE IF NOT EXISTS ... NOLOGIN` antes de los GRANTs. Idempotente en ambos entornos                     |

### 12.7 Operaciones comunes contra staging

```bash
# Re-deploy del API (push a main triggea)
git push origin main

# Re-bootstrap Keycloak (idempotente)
KEYCLOAK_URL=... KEYCLOAK_ADMIN=admin KEYCLOAK_ADMIN_PASSWORD=... \
  pnpm bootstrap:keycloak

# Re-seed (idempotente, upserts)
DATABASE_URL='postgresql://...' DIRECT_URL='postgresql://...' \
  pnpm --filter @pms/db exec tsx prisma/seed.ts

# Conectar via psql al postgres-app de staging
psql 'postgresql://postgres:<pwd>@<host>.proxy.rlwy.net:<port>/railway'

# Inspeccionar tablas y datos
psql ... -c '\dt'
psql ... -c 'SELECT id, slug, name FROM tenants;'
psql ... -c 'SELECT * FROM audit_log ORDER BY changed_at DESC LIMIT 10;'

# Logs en tiempo real (vía Railway dashboard)
# Cada servicio → pestaña "Deploy Logs" o "Build Logs"

# Métricas Prometheus expuestas en :9464 NO son accesibles públicamente
# desde fuera de Railway (no hay TCP proxy en ese puerto). Para verlas:
# desde otro servicio del proyecto via dominio privado, o expón el puerto
# si quieres scrape externo (no recomendado en staging).
```

### 12.8 Troubleshooting rápido

| Si...                                                       | Mira...                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| API crash en arranque                                       | Deploy Logs del servicio `api` — generalmente el error está en las primeras 30 líneas            |
| `/readyz` devuelve 503                                      | Body de la respuesta — `checks.db` o `checks.nats` indica qué subsistema falla                   |
| `/me` o `/properties` → 401 "Token missing tenant_id claim" | Re-ejecuta `pnpm bootstrap:keycloak` (probablemente el atributo no quedó persistido)             |
| `/properties` devuelve `[]` (con token válido)              | Falta el seed en la DB de staging — ejecuta el `seed` con la URL pública                         |
| Keycloak admin UI da 502                                    | `KC_HOSTNAME` debe llevar `https://` delante; `KC_PROXY_HEADERS=xforwarded`; `KC_HTTP_PORT=8080` |
| pnpm script peta con `dotenv-cli` no encuentra `.env`       | En staging las env vars vienen inyectadas — bypassea con `pnpm --filter X exec <bin>` directo    |
