# Sprint 1.5 — Pulir antes de Sprint 2

> **Duración:** 3-5 días.
> **Objetivo:** dejar la rama `claude/plan-hotel-saas-rWaWw` en estado mergeable a `main`, con CI verde, RUNBOOK claro y deploy reproducible. En paralelo: validar el alcance del Sprint 2 con 2-3 hoteles boutique.

## Por qué Sprint 1.5 (no saltar a Sprint 2)

Per ADR-007, Foundation puede avanzar en paralelo a la validación con hoteles, pero **antes de cerrar el alcance de Fase 2 (MVP FO)** hay que haber hablado con 2-3 hoteles. Sprint 1.5 nos compra ese tiempo y lo usa para:

1. **Dejar la base limpia** — CI, mergeo a main, runbook. Esto evita arrastrar deuda a Sprint 2.
2. **Validar con hoteles en paralelo** — sin presión técnica encima.
3. **Tener un baseline desplegado** — algo demostrable a los hoteles cuando hablemos con ellos.

## Tareas

### 1. CI verde en GitHub

- [ ] Verificar que el workflow `.github/workflows/ci.yml` se ejecute en PRs desde feature branches (no solo `main`).
- [ ] `pnpm format:check` pasa (formateo Prettier consistente en todo el repo).
- [ ] `pnpm lint` pasa en cada package.
- [ ] `pnpm typecheck` pasa en cada package.
- [ ] `pnpm test` (unit tests, NO integración) pasa en cada package.
- [ ] `pnpm build` pasa donde aplica.
- [ ] Lockfile `pnpm-lock.yaml` committeado en el repo.

### 2. Mergear a `main` con PR limpio

- [ ] Revisar el diff completo de la rama vs `main` (debería ser todo el código del Sprint 1).
- [ ] Abrir PR desde `claude/plan-hotel-saas-rWaWw` → `main` con descripción enlazando los 6 commits canónicos del Sprint 1.
- [ ] CI verde antes de mergear.
- [ ] Squash-merge o merge — preservando el historial detallado de los commits del Sprint.

### 3. RUNBOOK operativo

- [ ] `RUNBOOK.md` en la raíz: cómo levantar todo de cero en cualquier máquina, troubleshooting común, tareas de operación (reset DB, regenerar Keycloak, ver logs/métricas).

### 4. Discovery con hoteles (en paralelo)

- [ ] `docs/HOTEL-DISCOVERY.md` con la lista de preguntas a hacer en las 2-3 conversaciones de validación.
- [ ] Confirmar/ajustar el alcance MVP FO (§4.1 de PROJECT.md) con feedback real.
- [ ] Si el feedback obliga a cambios significativos, actualizar PROJECT.md (§4 + nuevo ADR).

### 5. Deploy a staging (opcional — depende de cuenta)

- [ ] Fly.io o Railway: API + Postgres + NATS + Keycloak desplegados.
- [ ] HTTPS detrás de un dominio del hotel (`*.pms.dev` o similar).
- [ ] Bootstrap de Keycloak ejecutado en staging.
- [ ] Health check externo verde (`curl https://api.staging/healthz` → 200).

## Fuera del alcance (Sprint 2 territory)

- UI de Front Office (esa es la Fase 2 entera).
- Cualquier feature de FO/NA/HSK.
- Channel manager, revenue management, POS.
- Multi-property en API (decidido en ADR-005: V2).

## Definition of Done del Sprint 1.5

- ✅ PR mergeado a `main` con CI verde.
- ✅ RUNBOOK probado en máquina nueva (Codespace fresco).
- ✅ Hablado con al menos 2 hoteles → notas escritas en `docs/HOTEL-DISCOVERY.md`.
- ✅ (Opcional) staging desplegado y accesible.

Cuando estos cuatro estén ✅, **Sprint 2 (MVP FO)** arranca con baseline sólido y feedback de mercado.
