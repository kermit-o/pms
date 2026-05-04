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

### 3. Multi-tenancy + Auth
- [ ] Bootstrap script del realm Keycloak `pms`.
- [ ] Middleware NestJS que valida JWT y extrae `tenant_id` + roles.
- [ ] Guard RBAC (decorador `@Roles()`).
- [ ] Test de aislamiento: usuario del tenant A no ve datos del tenant B (incluso bypaseando la app).

### 4. Event bus
- [ ] `packages/eventbus` con cliente NATS JetStream tipado.
- [ ] Catálogo inicial de eventos (Zod schemas).
- [ ] Publisher inyectable en NestJS.
- [ ] Consumer base con dead-letter handling.

### 5. MCP server skeleton
- [ ] `packages/mcp-tools` con server MCP básico.
- [ ] Tool de ejemplo: `get_tenant_info`.
- [ ] Cliente Claude conectado vía MCP en script de prueba.

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
