# Grafana — provisioning de Aubergine

> Dashboards y datasource para [ADR-023](../../PROJECT.md#adr-023). En el
> piloto los consume Grafana Cloud (free tier hasta 10k series); en
> self-hosted se montan los mismos archivos.

## Estructura

```
infra/grafana/
  datasources.yaml          # Prometheus (Cloud o self-hosted)
  dashboards.yaml           # provider de dashboards file-based
  dashboards/
    api-health.json         # SLOs API + status mix + rutas top
    housekeeping.json       # 9 series hsk_* de S4 W5
```

## Cómo se cargan

### Grafana Cloud

1. Provisionar **datasource Prometheus**: copia el endpoint y API key
   desde `Connections → Data sources → Prometheus` y crea un secret en
   tu CI/CD con `PROMETHEUS_URL`, `PROMETHEUS_USER`, `PROMETHEUS_PASSWORD`.
   Aplica `datasources.yaml` con esas variables substituidas.
2. **Importar dashboards**: desde la UI Cloud, `Dashboards → New →
Import → Upload JSON`. O via API:

   ```bash
   for f in infra/grafana/dashboards/*.json; do
     curl -X POST "$GRAFANA_URL/api/dashboards/db" \
       -H "Authorization: Bearer $GRAFANA_API_KEY" \
       -H 'content-type: application/json' \
       --data "$(jq -n --arg dash "$(cat $f)" '{dashboard: $dash | fromjson, overwrite: true}')"
   done
   ```

3. **Scraping**: configurar Prometheus de Grafana Cloud para scrapear
   `pms-api.internal:9464/metrics` y `pms-nats.internal:8222/varz` via
   un agente prometheus-on-fly (ver siguiente sección).

### Self-hosted (Grafana OSS)

1. Montar los archivos de provisioning:

   ```yaml
   # docker-compose.yml fragment
   grafana:
     image: grafana/grafana:11.2.0
     volumes:
       - ./infra/grafana/dashboards:/etc/grafana/dashboards:ro
       - ./infra/grafana/dashboards.yaml:/etc/grafana/provisioning/dashboards/aubergine.yaml:ro
       - ./infra/grafana/datasources.yaml:/etc/grafana/provisioning/datasources/aubergine.yaml:ro
     environment:
       PROMETHEUS_URL: http://prometheus:9090
   ```

2. Reiniciar Grafana — los dashboards aparecen en el folder "Aubergine".

## Métricas que cubren los dashboards

### `api-health.json`

Auto-instrumentación HTTP (OpenTelemetry semconv estable):

- `http_server_request_duration_seconds_*` (histogram, labels:
  `http_route`, `http_response_status_code`).
- `http_server_active_requests` (gauge).

Paneles:

- Throughput (req/s, 5m), error rate 5xx con SLO < 1%, p95 con SLO < 0.4 s,
  active connections.
- Latencia p50/p95/p99 timeseries.
- Status code mix.
- Top 10 rutas más lentas (p95).

### `housekeeping.json`

Las 9 series custom de S4 W5 (ver `apps/api/src/housekeeping/metrics.ts`):

- `hsk_tasks_assigned_total`, `hsk_tasks_started_total`,
  `hsk_tasks_completed_total`, `hsk_tasks_cancelled_total`.
- `hsk_task_duration_minutes_*` (histogram).
- `hsk_lost_found_registered_total`, `hsk_lost_found_resolved_total`.
- `hsk_pairings_minted_total`, `hsk_pairings_redeemed_total{outcome}`.

Paneles:

- KPIs 1h: assigned, completed, p95 duración, pairings OK.
- Tareas por estado (rate/min).
- Cuantiles de duración.
- Lost & Found registrados vs resueltos.
- Pairings outcome (alerta visual sobre `not_found` — posible
  enumeration).

## Dashboards pendientes (siguientes PRs)

| Dashboard          | Bloqueador                                                                 | Métricas que faltan                                                                                         |
| ------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `night-audit.json` | Counters custom no expuestos todavía                                       | `night_audit_run_started_total`, `_completed_total`, `_failed_total`, `night_audit_step_duration_seconds_*` |
| `eventbus.json`    | Necesita scraper `prometheus-nats-exporter` o lectura JSON de `:8222/varz` | `nats_jetstream_stream_messages`, `nats_consumer_pending`, `nats_consumer_delivered_total`                  |
| `compliance.json`  | Counters custom no expuestos                                               | `ses_submission_queued_total`, `_sent_total`, `_failed_total`, `ses_submission_age_seconds`                 |

Cada uno se entrega en un PR aparte que primero añade los counters al
service correspondiente, y luego el dashboard que los visualiza.

## Alertmanager (siguiente PR)

`infra/grafana/alerts.yaml` con las alertas listadas en SPRINT-5-PLAN
§2.3 (error rate, NA failed, SES failed, p95 task duration, pairings
not_found rate). Slack webhook + PagerDuty routing en `RUNBOOK §14`.
