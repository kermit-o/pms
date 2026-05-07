# syntax=docker/dockerfile:1.7
#
# Keycloak 25 para Fly.io — production mode.
#
# Patron oficial: 1) `kc.sh build --db=postgres` materializa la imagen
# optimizada para Postgres, luego 2) `kc.sh start --optimized` arranca sin
# rebuild. Hacemos ambas cosas en build-time y al runtime solo lanzamos.
#
# Build:
#   docker build -t pms-keycloak:local infra/fly/keycloak/
# Run:
#   docker run --rm -p 8080:8080 \
#     -e KC_DB_URL=jdbc:postgresql://host:5432/keycloak \
#     -e KC_DB_USERNAME=keycloak -e KC_DB_PASSWORD=... \
#     -e KEYCLOAK_ADMIN=admin -e KEYCLOAK_ADMIN_PASSWORD=... \
#     -e KC_HOSTNAME=auth.aubergine.es \
#     pms-keycloak:local

FROM quay.io/keycloak/keycloak:25.0 AS build

# Backend Postgres (Fly Postgres). El driver JDBC ya viene embebido en la
# imagen oficial — solo necesitamos declararlo via KC_DB.
ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true \
    KC_METRICS_ENABLED=true \
    KC_HTTP_ENABLED=true \
    KC_PROXY_HEADERS=xforwarded \
    KC_HOSTNAME_STRICT=false

# Build optimizado: precompila theme cache, omite providers no usados.
RUN /opt/keycloak/bin/kc.sh build

# ----------------------------------------------------------------------------
# Runtime
# ----------------------------------------------------------------------------
FROM quay.io/keycloak/keycloak:25.0

COPY --from=build /opt/keycloak/ /opt/keycloak/

ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true \
    KC_METRICS_ENABLED=true \
    KC_HTTP_ENABLED=true \
    KC_PROXY_HEADERS=xforwarded \
    KC_HOSTNAME_STRICT=false

EXPOSE 8080 9000

# El admin REST API + login UI viven en :8080. /health y /metrics en :9000.
# Fly proxy hace TLS termination — Keycloak escucha HTTP plano internamente
# y confia en X-Forwarded-* (KC_PROXY_HEADERS=xforwarded).
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized"]
