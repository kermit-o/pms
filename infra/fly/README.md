# Aubergine en Fly.io — playbook

> Plataforma elegida en [ADR-023](../../PROJECT.md#adr-023). Región primaria
> `cdg` (París) por residencia ES + GDPR. Réplica Postgres en `fra` para DR.

Esta carpeta es el **playbook**: el `fly.toml` por app vive con su código en
`apps/<name>/fly.toml` y los Dockerfiles en `apps/<name>/Dockerfile`. Aquí
solo va documentación + scripts de provisioning compartido.

## Apps

| App              | fly.toml                | Dockerfile                | Puerto | DNS público        |
| ---------------- | ----------------------- | ------------------------- | ------ | ------------------ |
| API NestJS       | `apps/api/fly.toml`     | `apps/api/Dockerfile`     | 3000   | `api.aubergine.es` |
| Web FO (Next.js) | `apps/web-fo/fly.toml`  | `apps/web-fo/Dockerfile`  | 3001   | `app.aubergine.es` |
| Web HSK (PWA)    | `apps/web-hsk/fly.toml` | `apps/web-hsk/Dockerfile` | 3002   | `hsk.aubergine.es` |

Las webs se conectan a la API por la red privada 6PN
(`pms-api.internal:3000`) — la API **no** se expone público hacia internet
salvo el endpoint `/health/ready` para los healthchecks externos.

## Primera vez: provisioning de toda la infra

Pre-requisito: `flyctl auth login` con la cuenta de `aubergine` (org).

```bash
# 1. Apps (la primera vez crea cada una; luego solo se hace 'deploy').
flyctl apps create pms-api      --org aubergine
flyctl apps create pms-web-fo   --org aubergine
flyctl apps create pms-web-hsk  --org aubergine
flyctl apps create pms-keycloak --org aubergine    # ver §3 abajo

# 2. Postgres managed por Fly. Primary cdg + replica fra para DR.
flyctl postgres create \
  --name pms-postgres \
  --org aubergine \
  --region cdg \
  --vm-size shared-cpu-2x \
  --volume-size 10
flyctl postgres attach pms-postgres -a pms-api

# Replica DR en Frankfurt (lectura solo; switchover manual).
flyctl postgres create-replica pms-postgres --region fra

# 3. Secrets compartidos (sustituir <...> con valores reales).
flyctl secrets set -a pms-api \
  NATS_URL="nats://pms-nats.internal:4222" \
  REDIS_URL="<upstash-url>" \
  KEYCLOAK_URL="https://auth.aubergine.es" \
  KEYCLOAK_REALM="pms" \
  KEYCLOAK_CLIENT_ID="pms-api" \
  PAIRING_SECRET="$(openssl rand -hex 32)" \
  SES_HOSPEDAJES_ENDPOINT="<endpoint-prod>" \
  SES_HOSPEDAJES_API_KEY="<api-key>"

flyctl secrets set -a pms-web-fo \
  NEXTAUTH_SECRET="$(openssl rand -hex 32)" \
  KEYCLOAK_CLIENT_SECRET="<from-keycloak>"

flyctl secrets set -a pms-web-hsk \
  NEXTAUTH_SECRET="$(openssl rand -hex 32)" \
  KEYCLOAK_CLIENT_SECRET="<from-keycloak>"

# 4. Deploy. SIEMPRE desde la raíz del monorepo con --build-context.
cd /path/to/pms

flyctl deploy -c apps/api/fly.toml      --build-context .
flyctl deploy -c apps/web-fo/fly.toml   --build-context .
flyctl deploy -c apps/web-hsk/fly.toml  --build-context .

# 5. DNS (Cloudflare → Fly). Para cada subdominio:
flyctl certs add api.aubergine.es -a pms-api
flyctl certs add app.aubergine.es -a pms-web-fo
flyctl certs add hsk.aubergine.es -a pms-web-hsk
# Y crear el CNAME apuntando al hostname que Fly emite.
```

## Despliegues recurrentes

```bash
# Después de mergear a main, deploy de cada app cuyo código cambió.
flyctl deploy -c apps/api/fly.toml --build-context .
```

Las migraciones Prisma corren automáticamente como `release_command` antes
del rolling update — si una migra falla, el rollout aborta y la versión
anterior sigue sirviendo.

## NATS, Redis, Object Storage, Keycloak

**NATS JetStream**: Fly Machine en `cdg` con `nats:2.10-alpine` y volumen
persistente `pms_nats_data` (5 GB). Stream `pms-events` con retention 7d
y dedup de 2min (envelope ADR-016). Detalle en
[`infra/fly/nats/`](./nats/).

**Redis**: managed por Upstash (EU region). No vive en Fly. La URL se inyecta
como `REDIS_URL` secret.

**Object storage (fotos lost-found, exports)**: Backblaze B2 EU-Central
con Cloudflare R2 delante para CDN. Buckets `aubergine-prod-photos` y
`aubergine-prod-exports`. Credenciales como secrets en `pms-api`.

**Keycloak**: Fly App `pms-keycloak` con imagen oficial Keycloak 25 (build
optimizado en runtime) y Postgres dedicado `pms-keycloak-db` aislado del
cluster de la API. Bootstrap del realm `pms` (clientes `pms-web`, `pms-hsk`,
`pms-api`) con el script `scripts/keycloak-bootstrap.ts` post-deploy.
Detalle en [`infra/fly/keycloak/`](./keycloak/).

## Observabilidad

`pms-api` expone `/metrics` en el puerto interno `9464`. Grafana Cloud lee
via la red privada 6PN; el puerto **no** se publica externamente. Dashboards
provisionados desde `infra/grafana/dashboards/` (PR aparte).

Logs vía `flyctl logs -a <app>` o agregados en Loki por el plugin de Fly.

## DR drill

Plan de drill mensual en RUNBOOK §14.3 (PR aparte). El drill verifica que
restaurar a un cluster paralelo desde el backup más reciente arroja
exactamente las mismas reservas/folios.

## Coste estimado del piloto

Ver ADR-023 — ~85 €/mes para 1 hotel boutique (8-30 habitaciones).
