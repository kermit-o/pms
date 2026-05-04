# PMS — AI-native Property Management System

SaaS de gestión hotelera con IA integrada desde el día uno. MVP enfocado en Front Office, Night Audit y Housekeeping.

> **Antes de tocar código o tomar decisiones, leer [`PROJECT.md`](./PROJECT.md).**
> Es la fuente única de verdad del proyecto: visión, alcance, arquitectura, decisiones y roadmap.

## Estado
- **Fase:** Foundation / Sprint 0 completado, Sprint 1 listo para empezar.
- **Plan del Sprint 1:** [`docs/SPRINT-1-PLAN.md`](./docs/SPRINT-1-PLAN.md)
- **Branch de desarrollo:** `claude/plan-hotel-saas-rWaWw`

## Estructura del monorepo

```
pms/
├── apps/
│   ├── api/        # NestJS backend (REST + MCP)
│   ├── web-fo/     # Next.js — Front Office + Night Audit (desktop)
│   └── web-hsk/    # Next.js PWA — Housekeeping (mobile-first)
├── packages/
│   ├── shared/     # Tipos, schemas Zod, utilidades compartidas
│   ├── db/         # Prisma schema, migraciones, RLS
│   ├── eventbus/   # Cliente NATS JetStream tipado + catálogo de eventos
│   └── mcp-tools/  # Definiciones MCP de cada acción del PMS
├── infra/          # docker-compose, configuración de servicios locales
├── docs/           # Planes de sprint, ADRs detallados, runbooks
└── PROJECT.md      # Documento maestro — fuente única de verdad
```

## Requisitos

- Node.js 20 LTS
- pnpm 9+
- Docker + Docker Compose

## Quick start

```bash
# 1. Copiar y ajustar variables de entorno
cp .env.example .env

# 2. Levantar infra local (Postgres, Redis, NATS, Keycloak, Mailhog)
pnpm infra:up

# 3. Instalar dependencias
pnpm install

# 4. (Sprint 1) Arrancar el API en dev
pnpm dev
```

## Stack

NestJS · PostgreSQL + Prisma · Redis + BullMQ · NATS JetStream · Next.js · Keycloak · Claude (Anthropic) · MCP. Detalles en [§6 de PROJECT.md](./PROJECT.md#6-stack-técnico-cerrado-2026-05-04).

## Contribución

1. Leer `PROJECT.md` completo.
2. Trabajar en la branch `claude/plan-hotel-saas-rWaWw` (ver §11 de `PROJECT.md`).
3. No introducir features fuera del alcance MVP sin actualizar el doc primero.
4. Conventional commits.
