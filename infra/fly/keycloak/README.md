# Keycloak en Fly.io (`pms-keycloak`)

> Identidad para `pms-web`, `pms-hsk` y `pms-api` en producción.
> Decisión de plataforma: [ADR-023](../../../PROJECT.md#adr-023).

## Componentes

| Pieza       | Detalle                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| App Fly     | `pms-keycloak` en `mad`                                                                                                                             |
| Imagen      | `quay.io/keycloak/keycloak:25.0` con `kc.sh build` aplicado                                                                                         |
| Postgres    | App separada `pms-keycloak-db` (Fly Postgres). **No** comparte cluster con `pms-postgres` (la DB de la API) — aislar el blast radius si una se cae. |
| Volume      | Ninguno. Toda la persistencia vive en el Postgres dedicado. Realm import se aplica via `scripts/keycloak-bootstrap.ts` post-deploy.                 |
| DNS         | `auth.aubergine.es` → CNAME a Fly                                                                                                                   |
| Métricas    | `:9000/metrics` (Prometheus, scrape via 6PN)                                                                                                        |
| Healthcheck | `:8080/health/ready`                                                                                                                                |

## Provisioning paso a paso

```bash
# 1. App.
flyctl apps create pms-keycloak --org aubergine

# 2. Postgres dedicado para Keycloak (separado del cluster de la API).
flyctl postgres create \
  --name pms-keycloak-db \
  --org aubergine \
  --region mad \
  --vm-size shared-cpu-1x \
  --volume-size 3
flyctl postgres attach pms-keycloak-db -a pms-keycloak \
  --database-name keycloak \
  --variable-name KC_DB_URL_RAW
# La attach setea DATABASE_URL, pero Keycloak espera KC_DB_URL en formato JDBC.
# Lo transformamos manualmente en el siguiente paso.

# 3. Construir KC_DB_URL en formato JDBC desde la URL bruta.
RAW=$(flyctl secrets list -a pms-keycloak --json | jq -r '.[] | select(.Name=="KC_DB_URL_RAW") | .Value')
# Patron: postgres://user:pass@host:5432/db -> jdbc:postgresql://host:5432/db
JDBC=$(echo "$RAW" | sed -E 's|^postgres://([^:]+):([^@]+)@([^/]+)/(.+)$|jdbc:postgresql://\3/\4|')
USER=$(echo "$RAW" | sed -E 's|^postgres://([^:]+):.*|\1|')
PASS=$(echo "$RAW" | sed -E 's|^postgres://[^:]+:([^@]+)@.*|\1|')

flyctl secrets set -a pms-keycloak \
  KC_DB_URL="$JDBC" \
  KC_DB_USERNAME="$USER" \
  KC_DB_PASSWORD="$PASS" \
  KEYCLOAK_ADMIN="admin" \
  KEYCLOAK_ADMIN_PASSWORD="$(openssl rand -hex 24)"

# Guarda el password admin en el vault del equipo — solo se usa para el
# bootstrap. En operativa diaria usamos el realm 'pms' con users normales.

# 4. Deploy.
flyctl deploy -c infra/fly/keycloak/fly.toml --build-context infra/fly/keycloak

# 5. Espera ~60s hasta que /health/ready devuelva UP, luego bootstrap del
# realm 'pms' con sus clientes (pms-web, pms-hsk, pms-api), roles y user
# attribute mapper de tenant_id.
KEYCLOAK_URL="https://auth.aubergine.es" \
KEYCLOAK_ADMIN="admin" \
KEYCLOAK_ADMIN_PASSWORD="<el de arriba>" \
KEYCLOAK_REALM="pms" \
KEYCLOAK_CLIENT_ID="pms-api" \
  pnpm bootstrap:keycloak

# 6. Capturar los client secrets que el script imprime y propagarlos a la
# API y a las webs:
flyctl secrets set -a pms-api KEYCLOAK_CLIENT_SECRET="<pms-api-secret>"
flyctl secrets set -a pms-web-fo KEYCLOAK_CLIENT_SECRET="<pms-web-secret>"
flyctl secrets set -a pms-web-hsk KEYCLOAK_CLIENT_SECRET="<pms-hsk-secret>"

# 7. DNS — Cloudflare CNAME auth.aubergine.es -> <pms-keycloak>.fly.dev
flyctl certs add auth.aubergine.es -a pms-keycloak
```

## Operativa diaria

Logs:

```bash
flyctl logs -a pms-keycloak
```

Restart suave (p.ej. tras setear un secret nuevo):

```bash
flyctl deploy -c infra/fly/keycloak/fly.toml --build-context infra/fly/keycloak --strategy rolling
```

Crear un usuario nuevo del piloto: usar la UI Admin en
`https://auth.aubergine.es/admin/` (login con `KEYCLOAK_ADMIN`) o re-correr
`scripts/keycloak-bootstrap.ts` con un YAML extendido (Sprint 5 W2 onboarding).

## Cosas que pueden ir mal

- **`/health/ready` tarda > 60s la primera vez** — Keycloak hace migración
  inicial del schema. `grace_period = "60s"` en fly.toml lo absorbe; si
  tarda más, mira `flyctl logs` por errores de conexión a Postgres.
- **`Hostname not allowed`** — `KC_HOSTNAME` debe coincidir con el DNS
  publicado. Si cambias el dominio, secret + redeploy.
- **`Failed to bind to port`** — alguien dejó otra app escuchando en :8080
  dentro de la misma Fly Machine. Revisa el `[[services]]` del fly.toml.
- **Bootstrap del realm `pms` falla con 401** — `KEYCLOAK_ADMIN_PASSWORD`
  no fue setado o el container reset el password. Verifica con
  `flyctl secrets list -a pms-keycloak`.

## Backups

Keycloak persiste todo en `pms-keycloak-db`. Backups WAL automáticos por
Fly Postgres (cada 24h, retention 7d). Para restore en DR drill:

```bash
flyctl postgres restore pms-keycloak-db <snapshot-id>
```

## Fuera de alcance (siguientes PRs)

- Themes custom (logo Aubergine en login). MVP usa default.
- HA multi-region. Single instance basta para piloto. Si la latencia desde
  `fra` o `ams` se vuelve un problema, levantar replicas con
  `KC_CACHE_STACK=kubernetes`.
- Federation con AD/LDAP — algunos hoteles familiares no tienen, otros sí.
  V2 cuando un cliente lo pida.
