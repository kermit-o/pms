# Sprint 1 — Foundation

> **Objetivo del sprint:** dejar la base técnica lista para que Sprint 2 (MVP FO) pueda empezar sin bloqueos arquitecturales. **Sin features de negocio todavía.**

## Estado al inicio del sprint
- ✅ Monorepo pnpm + Turbo configurado.
- ✅ Tooling base (Prettier, EditorConfig, .gitignore, .nvmrc).
- ✅ tsconfig.base.json compartido.
- ✅ docker-compose con Postgres, Redis, NATS, Keycloak, Mailhog.
- ✅ CI scaffold (format, lint, typecheck, test, build).
- ✅ Estructura de `apps/` y `packages/` con READMEs explicativos.

## Tareas del sprint

### 1. API skeleton (NestJS) ✅
- [x] Inicializar `apps/api` con NestJS strict mode.
- [x] Integrar en monorepo (workspace deps, tsconfig extends).
- [x] Health check endpoint (`/healthz`, `/readyz`).
- [x] Logger estructurado (Pino) con `correlation_id`.
- [x] Config module con validación Zod de env vars.

### 2. Capa de datos (Prisma) ✅
- [x] Inicializar `packages/db` con Prisma.
- [x] Schema base: `Tenant`, `User`, `Property`, `AuditLog`.
- [x] Migración inicial con DDL + RLS + triggers + GRANTs.
- [x] Helper `withTenant()` que setea `app.tenant_id` por transacción.
- [x] Políticas RLS aplicadas vía migración SQL (FORCE en users/properties; SELECT-only en audit_log).
- [x] Trigger de audit `SECURITY DEFINER` en users/properties.
- [x] Seed de un tenant demo + admin user + property BCN01.
- [x] Roles separados: `pms` (owner/migraciones) vs `pms_app` (runtime).
- [x] DbModule + PrismaService integrados en apps/api; `/readyz` chequea DB.
- [x] Test integración RLS: aislamiento entre tenants + append-only audit.

### 3. Auth con Keycloak ✅
- [x] Bootstrap script idempotente (`scripts/keycloak-bootstrap.ts`) — crea realm `pms`, client `pms-api`, realm roles, User Attribute mapper `tenant_id`, usuario demo `admin@demo.local`.
- [x] `JwtValidatorService` con `jose` + `createRemoteJWKSet` (caché y rotación automática).
- [x] `JwtAuthGuard` global con `@Public()` para opt-out (healthz/readyz).
- [x] `RolesGuard` global con `@Roles('front_desk', ...)`.
- [x] `@CurrentUser()` decorator inyecta `AuthUser` en handlers.
- [x] Endpoint demo `/me` (cualquier rol autenticado).
- [x] Endpoint demo `/properties` (sólo `tenant_admin`/`front_desk`/`night_auditor`) que demuestra el flujo JWT → tenantId → withTenant → RLS.
- [x] Tests unitarios de JwtAuthGuard y RolesGuard (mock JwtValidator).
- [x] Tests e2e: rutas públicas funcionan sin token; rutas protegidas devuelven 401/403 correctamente.

### 4. Event bus ✅
- [x] `packages/eventbus` con cliente NATS JetStream tipado y envelope estándar.
- [x] Catálogo inicial Zod (`property.created` v1, `property.updated` v1) con `schemaVersion` por entrada.
- [x] `EventPublisher` con validación Zod previa al publish y `Nats-Msg-Id` para dedup.
- [x] Stream `pms-events` (Limits / file / 30 días) bootstrap idempotente.
- [x] `EventbusService` en NestJS con lifecycle (connect/drain) — `/readyz` ahora chequea NATS.
- [x] Test integración round-trip publish + consume contra NATS real.
- [ ] Consumer base + dead-letter handling — diferido a Sprint 2 cuando empecemos a consumir eventos en services.

### 5. MCP server skeleton ✅
- [x] `packages/mcp-tools` con `ToolRegistry` tipado (input Zod → JSON Schema, validación previa al handler, runtime checks de duplicado / unknown tool).
- [x] `createMcpServer(registry, ctx)` adapter transport-agnostic encima del MCP SDK (handlers `ListTools` y `CallTool`).
- [x] Tool inicial `get_tenant_info` que usa `prisma.withTenant()` para que RLS aplique y el audit log registre la invocación.
- [x] Entry point stdio `scripts/mcp-server.ts` ejecutable con `pnpm mcp:server` — listo para `claude_desktop_config.json`.
- [x] Tests unitarios del registry (register, list, invoke, validación, unknown).
- [ ] HTTP/SSE transport montado en NestJS — diferido a Sprint 2 (necesita extracción de tenant del JWT por request).

### 6. Observabilidad
- [ ] OpenTelemetry instrumentado en API.
- [ ] Logs estructurados a stdout.
- [ ] Métricas Prometheus en `/metrics`.

### 7. CI/CD real
- [ ] GitHub Actions ejecutando los pasos definidos en `.github/workflows/ci.yml`.
- [ ] Branch protection en `main` (requiere CI verde).
- [ ] Conventional commits + commitlint.

## Definition of Done del sprint

- `pnpm infra:up` levanta todo en local sin errores.
- `pnpm dev` arranca el API en watch mode.
- `curl localhost:3000/healthz` responde 200.
- Test de aislamiento multi-tenant pasa.
- CI verde en GitHub.
- Un evento publicado por el API se ve en el monitor de NATS.
- Una tool MCP es invocable desde Claude Desktop o un script.

## Fuera del scope del sprint
- Cualquier feature de FO/NA/HSK.
- UI (Next.js apps).
- Despliegue a entorno cloud.
- Pricing, billing, onboarding de tenants.
