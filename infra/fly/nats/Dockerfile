# syntax=docker/dockerfile:1.7
#
# NATS JetStream para Fly.io — single instance con volumen persistente.
#
# La imagen oficial nats:2.10-alpine es ~25 MB. Le pegamos nuestro
# nats-server.conf con JetStream activado y store_dir = /data/jetstream
# (montado por Fly Volume).

FROM nats:2.10-alpine

COPY nats-server.conf /etc/nats/nats-server.conf

EXPOSE 4222 8222

# Por defecto la imagen ejecuta nats-server. Le pasamos nuestro conf.
CMD ["-c", "/etc/nats/nats-server.conf"]
