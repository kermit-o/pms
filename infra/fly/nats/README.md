# NATS JetStream en Fly.io (`pms-nats`)

> Eventbus de Aubergine. ADR-016 + [ADR-023](../../../PROJECT.md#adr-023).

## Componentes

| Pieza     | Detalle                                                      |
| --------- | ------------------------------------------------------------ |
| App Fly   | `pms-nats` en `cdg`                                          |
| Imagen    | `nats:2.10-alpine` con `nats-server.conf` propio             |
| Volume    | `pms_nats_data` (5 GB) montado en `/data`                    |
| TCP 4222  | Cliente NATS (interno, 6PN)                                  |
| HTTP 8222 | `/healthz` + `/varz` (Prometheus, 6PN)                       |
| Cluster   | Single instance. HA multi-instance llega en V2 si justifica. |

## Provisioning

```bash
# 1. App + volumen.
flyctl apps create pms-nats --org aubergine
flyctl volumes create pms_nats_data \
  --region cdg \
  --size 5 \
  -a pms-nats

# 2. Deploy.
flyctl deploy -c infra/fly/nats/fly.toml --build-context infra/fly/nats

# 3. Crear el stream del catalogo desde el CLI nats (instalable en local
#    con: brew install nats-io/nats-tools/nats).
NATS_URL=nats://pms-nats.fly.dev:4222 nats stream add pms-events \
  --subjects 'pms.events.>' \
  --storage file \
  --retention limits \
  --max-age=7d \
  --max-msgs=-1 \
  --max-bytes=2GB \
  --discard old \
  --replicas 1 \
  --duplicate-window=2m

# 4. Setear NATS_URL en pms-api (red privada 6PN, sin TLS — todo el
#    trafico vive dentro de Fly).
flyctl secrets set -a pms-api NATS_URL="nats://pms-nats.internal:4222"
```

## Operativa diaria

Listar streams y consumers:

```bash
NATS_URL=nats://pms-nats.fly.dev:4222 nats stream ls
NATS_URL=nats://pms-nats.fly.dev:4222 nats consumer ls pms-events
```

Logs:

```bash
flyctl logs -a pms-nats
```

Métricas — Prometheus scrapea `:8222/varz` (lag de consumers, msgs/s,
storage usage). Los dashboards Grafana se provisionan en
`infra/grafana/` (PR aparte).

## Cosas que pueden ir mal

- **Stream `pms-events` no existe** — primer deploy se olvidó del paso 3.
  Re-corre el `nats stream add`.
- **Volumen lleno** — `max_bytes=2GB` por stream, pero si añadimos más
  streams sin pruning vamos al límite. Aumenta `flyctl volumes extend
pms_nats_data --size 10`.
- **Conexiones rechazadas (max_connections)** — algún consumer se reabre
  en bucle. Mira `flyctl logs -a pms-nats` con grep `Connection`.
- **Mensajes duplicados** — sigue activo el `duplicate-window=2m` per
  stream. La API publica con header `Nats-Msg-Id` (envelope estándar
  ADR-016). Si ves dups, verificar que el publisher no rota el id en
  retries.

## Backups

JetStream no expone un dump nativo limpio. Para restore en DR drill:

```bash
# 1. Snapshot del stream (full content).
NATS_URL=... nats stream backup pms-events ./pms-events.tar

# 2. Restore en cluster nuevo.
NATS_URL=... nats stream restore ./pms-events.tar
```

El backup se programa como cron job en GitHub Actions semanalmente
(follow-up post-piloto: el piloto opera con 7d retention, perder 1
semana de eventos es aceptable durante DR — los snapshots del Postgres
son la fuente de verdad).

## Cuándo migrar a HA

Detonantes:

- > 5 hoteles activos concurrentes.
- p99 publish latency > 50 ms sostenido.
- Caídas de Fly Machine que duren > 1 min/mes.

Plan: 3 instancias replicadas (`cdg`, `fra`, `ams`) con cluster
configurado en `nats-server.conf`. Streams pasan a `--replicas 3`.
Estimación de coste: ~3× lo actual (~30 €/mes adicional).

## Fuera de alcance

- TLS sobre el listener — no necesario dentro de 6PN. Si abrimos NATS al
  exterior, generar certificados con Fly + activar `tls{}` en el conf.
- mTLS entre cliente y NATS — V2.
- Auth (NATS supports user/password, JWT, NKey) — el aislamiento de red
  6PN es la primera línea; añadir auth si conectamos clientes externos.
