# Aubergine PMS · Review Checklist

> Lista de comprobación usada en la revisión de PRDs, RFCs y PRs de
> código. No es exhaustiva — es lo mínimo que **no se puede pasar por
> alto**.
>
> El revisor marca cada casilla. Si alguna no aplica, lo dice
> explícitamente ("N/A porque..."). Saltar una sin explicación es razón
> de rechazo.

---

## A · Revisión de un PRD

- [ ] Tiene un slot en `docs/prd/000-aubergine-master.md` que lo
      justifica (bloque y función específica).
- [ ] El "problema" describe una situación real del recepcionista/hotelero,
      no una idea técnica.
- [ ] El "para quién" es específico (tipo y tamaño de hotel).
- [ ] Los criterios de aceptación son demostrables en una demo de
      ≤ 30 s cada uno.
- [ ] El "fuera de alcance" no está vacío.
- [ ] No contiene decisiones técnicas (esas van al RFC).
- [ ] No cambia el stack (CLAUDE.md §3) sin ADR específico referenciado.
- [ ] Firma del PO presente.

---

## B · Revisión de un RFC

### B.1 · Alineamiento

- [ ] Referencia un PRD `Approved`.
- [ ] No expande el scope del PRD silenciosamente.
- [ ] No introduce features adicionales "de paso".

### B.2 · Datos y multitenancy

- [ ] Migración Prisma es forward-only y safe bajo escrituras
      concurrentes (expand → backfill → contract).
- [ ] Toda tabla nueva lleva `tenant_id` y política RLS.
- [ ] Toda query nueva pasa por `withTenant(ctx, ...)` salvo
      excepciones documentadas (webhooks autenticados, migrations).
- [ ] Índices justificados (no "por si acaso").

### B.3 · API y contratos

- [ ] DTOs validados con Zod en el edge.
- [ ] Endpoints state-mutating con `idempotency_key`.
- [ ] Errores como excepciones Nest tipadas.
- [ ] Eventos NATS documentados (subject + payload + garantías).

### B.4 · Compliance

- [ ] PAN nunca sale del browser → Stripe Elements (PCI SAQ A).
- [ ] PII tratada conforme GDPR (erasure, portabilidad).
- [ ] Si toca SES.HOSPEDAJES / Verifactu / INE, el RFC lo dice
      explícitamente y referencia el ADR correspondiente.

### B.5 · Tests

- [ ] Lista de specs unitarios concreta.
- [ ] Integration tests si toca BD/eventos/Stripe.
- [ ] E2E Playwright si toca user flow.
- [ ] Lo que NO se testea está justificado.

### B.6 · Observabilidad

- [ ] Logs estructurados con `tenantId`, `correlationId`, `actorId`.
- [ ] Métricas nuevas: nombre + labels + cardinalidad acotada.
- [ ] Trazas: spans en operaciones lentas o cross-service.

### B.7 · Rollout

- [ ] Feature flag declarado si toca prod multitenant.
- [ ] Plan de rollback explícito.
- [ ] Orden de despliegue claro (BD → API → web).

### B.8 · Alternativas

- [ ] Al menos dos alternativas consideradas.
- [ ] Cada descarte tiene razón.

### B.9 · Dependencias externas

- [ ] Toda librería nueva está justificada (coste, licencia,
      mantenimiento) — CLAUDE.md §8.
- [ ] No se introduce nuevo SaaS sin ADR.

### B.10 · Firma

- [ ] Tech reviewer firmó.
- [ ] PO firmó.

---

## C · Revisión de un PR de código

### C.1 · Anclaje

- [ ] El PR referencia un RFC `Approved` (o explica por qué cae en una
      de las excepciones de PROCESS.md §6).
- [ ] El branch sigue convención: `claude/<slug>` o `feat/<slug>`.
- [ ] Conventional commits en cada commit.

### C.2 · Definition of Done (CLAUDE.md §6.3)

- [ ] `pnpm --filter <pkg> typecheck` verde en cada paquete tocado.
- [ ] `pnpm --filter <pkg> lint` verde.
- [ ] `pnpm --filter <pkg> test` verde, con tests nuevos para la
      lógica añadida.
- [ ] Sin `console.log`, sin `any`, sin código comentado.
- [ ] Sin `@ts-ignore` / `eslint-disable` / `.skip` no justificados.
- [ ] Docs actualizadas (RUNBOOK, módulo README, contratos API).
- [ ] Entrada en `DELIVERY-LOG.md` añadida (más reciente arriba).

### C.3 · Seguridad y tenant

- [ ] Toda query Prisma pasa por `withTenant`.
- [ ] Toda respuesta de error es safe (no fuga PII / cross-tenant).
- [ ] Endpoints nuevos tienen guard de auth + roles.
- [ ] Webhooks verifican firma (Stripe, Postmark, ...).

### C.4 · Migración

- [ ] Forward-only.
- [ ] Si DROP de columna, está separado en migración posterior.
- [ ] Backfill en SQL `UPDATE` controlado o en script de aplicación.
- [ ] Probada en local + staging antes de prod.

### C.5 · Frontend

- [ ] RSC por defecto, client component solo si hay interacción.
- [ ] Sin secretos client-side.
- [ ] Estados de carga / error en cada mutación.
- [ ] Strings ES revisados.

### C.6 · Estado de PRD/RFC

- [ ] Al mergear, el RFC pasa a `Shipped` (si era el último PR).
- [ ] El PRD pasa a `Shipped` cuando todos sus RFCs están `Shipped`.
- [ ] Si la implementación divergió del RFC, el RFC se actualiza en el
      mismo PR o en uno adjunto.

### C.7 · ADR

- [ ] Si el PR introduce una decisión arquitectónica perdurable, hay un
      ADR nuevo en el mismo PR o referenciado.
- [ ] Si supersede a un ADR, el viejo cambia a `Superseded by ADR-NNN`.

---

## D · Causas de rechazo automático

Sin discusión:

- 🛑 PR sin RFC y no encaja en las excepciones de PROCESS.md §6.
- 🛑 Migración destructiva sin paso intermedio.
- 🛑 Query sin `withTenant` en código nuevo.
- 🛑 Secreto / credencial / UUID hardcoded.
- 🛑 Test desactivado para "que pase CI".
- 🛑 `any` o `@ts-ignore` sin justificación adyacente.
- 🛑 Cambio de tech stack (CLAUDE.md §3) sin ADR.
- 🛑 Nueva dependencia npm sin aprobación previa.

---

_Última actualización: 2026-06-01_
