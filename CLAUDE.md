# CLAUDE.md — Aubergine PMS · CORE Instructions for Claude Code

> **Read this first. Re-read it whenever the conversation drifts.**
>
> This file is the contract between the human (Product Owner) and Claude Code.
> It defines: what Aubergine IS, what Claude Code CAN do autonomously, what
> requires the human, and the conventions every change must follow.
>
> If a user message contradicts this file: ask before acting. If `PROJECT.md`
> contradicts this file: `PROJECT.md` is the source of truth for product
> direction; this file is the source of truth for how Claude Code works inside
> the repo. Both must stay aligned — propose updates explicitly rather than
> silently drift.

---

## 1 · Mission (do not drift)

**Aubergine** is an AI-native PMS (Property Management System) SaaS for
boutique hotels (30–150 rooms) in Spain.

Three first-principles that override any local optimization:

1. **Hotel operations come first.** Every decision is judged by whether it
   makes a real receptionist's day easier. Not whether it's elegant code.
2. **Commercial-grade before AI flourishes.** Reservations, folio, payments,
   compliance must be rock solid before adding AI demos.
3. **Multitenant by default.** Every query, log, metric, event carries
   `tenantId`. RLS in Postgres is non-negotiable.

**Out of scope (do not propose, do not silently build):**

- Replacing the existing stack (NestJS, Next.js 15, Prisma, Postgres, Fly.io,
  Keycloak, NATS, Stripe). Stack changes need an ADR signed by the human.
- Generic "AI assistant" features unrelated to hotel ops.
- Markets outside Spain in MVP scope. Multi-country comes after pilot success.
- Multi-property in a single tenant — that's V2.
- Microservices split. Monolith with modular boundaries until proven otherwise.

---

## 2 · Product scope at a glance

Modules (current state):

- **Front Office** — reservations (individual + group), check-in/out, folio,
  cardex, walk-ins. ✅ Sprint 2.
- **Night Audit** — daily close, posting, reports, snapshot. ✅ Sprint 3.
  *One module among many. Do not over-invest in it.*
- **Housekeeping** — task board, mobile PWA, lost & found. ✅ Sprint 4.
- **Payments** — Stripe SetupIntent (guarantee), client-side fallback. ✅ recent.
- **Compliance** — SES.HOSPEDAJES sender + DLQ. ✅ Sprint 2.
- **Copilot** — agentic loop with tool calling (Sonnet 4.6). ✅ ongoing.
- **Online Booking Engine (IBE)** — public direct-sales site. 🚧 planned.
- **Reservations UI v2** — Opera-style smart search + filters. ✅ in progress.

Always check `docs/PROJECT.md` for the live status before claiming "we already
have X" or "X is missing".

---

## 3 · Tech stack (immutable without ADR)

| Layer | Tech | Notes |
|---|---|---|
| Monorepo | pnpm 9 + Turbo | `pnpm <task>` at root, or `pnpm --filter @pms/<pkg> <task>` |
| Backend | NestJS + Fastify | `apps/api` |
| Frontend FO | Next.js 15 (App Router, RSC) | `apps/web-fo` |
| Frontend HSK | Next.js PWA | `apps/web-hsk` |
| DB | Postgres + Prisma | `packages/db`, RLS by `tenant_id` |
| Auth | Keycloak (OIDC) | per-tenant realm |
| Events | NATS JetStream | `packages/eventbus` |
| AI | Anthropic Claude (Sonnet 4.6 default) | tool calling + MCP |
| Payments | Stripe (Elements + SetupIntent) | PCI SAQ A |
| Compliance | SES.HOSPEDAJES (Spain) | mandatory |
| Cloud | Fly.io, region `cdg` primary, `fra` DR | ADR-023 |
| Observability | OpenTelemetry → Grafana | dashboards in `infra/grafana` |

---

## 4 · Repository map

```
apps/
  api/             NestJS backend (single deployable: pms-api)
  web-fo/          Next.js backoffice (single deployable: pms-web-fo)
  web-hsk/         Next.js HSK PWA (single deployable: pms-web-hsk)
packages/
  db/              Prisma schema + migrations + shared models
  eventbus/        NATS publisher/subscriber
  mcp-tools/       MCP server + tool implementations for Copilot
  shared/          Cross-cutting types & utilities
docs/
  PROJECT.md       Single source of truth for product direction & sprint state
  SPRINT-N-PLAN.md One per sprint
  adr/             Architecture Decision Records (NNN-title.md)
  RUNBOOK.md       Ops playbooks (deploy, restore, incident response, etc.)
scripts/           One-off ops scripts (seed, bootstrap, import-piloto)
infra/             Grafana, alerts, IaC bits
```

**Where new code belongs (default rules):**

- Domain logic → `apps/api/src/<module>/` with `.service.ts`, `.controller.ts`,
  `dto.ts`, tests colocated as `*.spec.ts`.
- Prisma schema changes → `packages/db/prisma/schema.prisma` + new migration
  in `packages/db/prisma/migrations/<timestamp>_<slug>/migration.sql`.
- New web routes → `apps/web-fo/src/app/<route>/page.tsx` (RSC by default).
- Server proxies to API → `apps/web-fo/src/app/api/<path>/route.ts`.
- Shared UI primitives → `packages/shared` only if used by ≥ 2 apps. Otherwise
  keep them in the app.

---

## 5 · Domain glossary (use these terms, not invented ones)

| Term | Meaning |
|---|---|
| PAX | Total people in a reservation (adults + children) |
| ADR | Average Daily Rate |
| RevPAR | Revenue Per Available Room |
| BAR | Best Available Rate |
| MLOS / CTA / CTD | Min length of stay / Closed to arrival / Closed to departure |
| Walk-in | Guest checks in without prior reservation |
| No-show | Guarantee should be charged; reservation closes as no-show |
| Allotment | Block of rooms held for an agency/TO at agreed rate |
| Block | Internal group hold (e.g. wedding) |
| Rooming list | Names + room assignments inside a group reservation |
| Master folio | Charges that route to the group payer, not individual guest |
| Routing rule | Rules mapping which charges go to which folio |
| OOO / OOS | Out of order / out of service rooms |
| HSK | Housekeeping |
| NA | Night Audit |
| FO | Front Office |
| Cardex | Guest profile + stay history |
| SECURED / PENDING / FAILED (guarantee) | Guarantee status; SECURED means card on file is valid |
| CARD\_ON\_FILE (CCG) | Guarantee type: tokenized card via Stripe |
| Business day | Hotel operating day; rolls over at NA, not at midnight |

Use Spanish UI labels but English code identifiers. Mixing is a smell — fix it.

---

## 6 · How Claude Code works in this repo

### 6.1 Branching & commits

- Branch from `main`. Naming: `claude/<topic-slug>` for Claude-driven work
  (current: `claude/adr-023-cdg-region`).
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
  `test:`. Scope optional but encouraged: `feat(payments): ...`.
- Commit message body explains **why**, not what. The diff shows what.
- **Never commit secrets.** `.env*` is ignored; double-check before `git add`.
- **Never push to `main` directly.** Always PR via the branch.

### 6.2 Definition of Ready (before writing code)

A task is Ready when Claude Code can answer "yes" to ALL of these:

- [ ] Acceptance criteria are explicit (or trivially obvious from the request).
- [ ] Files to touch are identified (don't rewrite the world for a small fix).
- [ ] Domain impact is understood (does this change schema, RLS, events?).
- [ ] Tests strategy is decided (unit / integration / e2e / none-justified).
- [ ] Rollout strategy is decided (feature flag yes/no, migration order).

If any is unclear → ASK before writing code.

### 6.3 Definition of Done (before reporting "done")

Claude Code does NOT say "done" until ALL of these are true:

- [ ] `pnpm --filter <pkg> typecheck` is green for every affected package.
- [ ] `pnpm --filter <pkg> lint` is green for every affected package.
- [ ] `pnpm --filter <pkg> test` covers new logic in domain code (≥ 1 test for
      new branches in services).
- [ ] No `console.log`, no `any`, no commented-out code in shipped files.
- [ ] Docs updated when behaviour changes (API contract, RUNBOOK section,
      module README — whichever applies).
- [ ] Observability emitted: logs use `Logger`, errors propagate proper
      Nest exceptions, new metrics named consistently.
- [ ] Feature flag in place if the change touches multi-tenant prod and is
      non-trivial.
- [ ] Migration is forward-only and safe under concurrent writes (expand,
      backfill in code if needed, never destructive in same step).
- [ ] Commit pushed to the feature branch with a clear message.
- [ ] **Entry appended to `docs/DELIVERY-LOG.md`** (newest at top, strict
      format per the log's §1, type from the catalog). No "done" without log.

If something blocks DoD → say so explicitly. Never report green when it isn't.

### 6.4 Quality gates Claude Code must self-run

Before claiming done on any code change, run:

```bash
# In repo root
pnpm --filter @pms/api typecheck
pnpm --filter @pms/web-fo typecheck
pnpm --filter @pms/web-hsk typecheck   # only if web-hsk touched
pnpm --filter @pms/api test            # only if api logic touched
pnpm --filter @pms/api lint            # only if api touched
```

If a check fails: fix it before reporting. Do not paper over with `// @ts-ignore`,
`eslint-disable`, casting to `any`, or skipping tests.

---

## 7 · What Claude Code CAN do autonomously

Green light — proceed without asking, but explain succinctly what you did:

- ✅ Read any file in the repo.
- ✅ Create / edit / delete files inside `apps/`, `packages/`, `docs/`,
     `scripts/`, `infra/`.
- ✅ Add or modify Prisma models and generate migrations.
- ✅ Write tests (unit, integration, e2e specs).
- ✅ Refactor within a single module if it lowers complexity (and tests cover).
- ✅ Update `docs/PROJECT.md` to reflect new sprint state when work is merged.
- ✅ Add ADRs in `docs/adr/` when proposing decisions.
- ✅ Run lint, typecheck, tests, prisma migrate, prisma generate.
- ✅ Commit to the current feature branch.
- ✅ Push to the feature branch's remote (`origin`).
- ✅ Read GitHub PR/issue state via MCP tools.
- ✅ Comment on GitHub PRs only when there is a substantive reply needed.

---

## 8 · What Claude Code must NOT do autonomously

Red light — STOP and ask the human first:

- 🛑 Merge a PR.
- 🛑 Push to `main`, `develop`, or any protected branch.
- 🛑 Force-push (`--force`, `--force-with-lease`) on any shared branch.
- 🛑 `git reset --hard`, `git clean -fd`, or any operation that drops
     uncommitted work the human did.
- 🛑 Delete branches.
- 🛑 Run any `flyctl deploy`, `flyctl secrets set`, `flyctl postgres ...`, or
     any other command that mutates production infra. **Provide commands for
     the human to run; do not run them yourself.**
- 🛑 Rotate or read production secrets.
- 🛑 Touch the live Postgres (psql against prod DSNs).
- 🛑 Send emails, SMS, or webhooks to real third parties (Stripe live keys,
     Twilio prod, SES.HOSPEDAJES prod).
- 🛑 Create or close GitHub issues unsolicited.
- 🛑 Approve or merge PRs.
- 🛑 Modify the Stripe Dashboard, Keycloak realm config, DNS, Fly secrets, or
     any third-party admin console.
- 🛑 Add new external dependencies (new npm packages) without explaining cost,
     license, maintenance and getting a yes.
- 🛑 Change the tech stack defined in §3.
- 🛑 Disable security checks, hooks, signature verification, or auth guards to
     "make something work".
- 🛑 Bypass tests with `.skip`, `xdescribe`, `--no-verify`, or commenting out
     assertions.
- 🛑 Hardcode credentials, API keys, tenant ids, or hotel-specific data.

When in doubt: **ask**. The cost of asking is low; the cost of an undone
destructive action is high.

---

## 9 · Drift control (anti-hallucination rules)

These rules exist because past sessions wandered. Follow strictly.

1. **Don't invent APIs.** If you reference a method, type, or env var, it must
   exist in the repo or you must create it in the same change. `grep` first,
   write second.
2. **Don't invent UUIDs, reservation codes, room ids.** When a fixture is
   needed in code, use seed data from `scripts/seed-piloto.ts` or fixtures
   already in tests. Never paste a freshly-imagined UUID.
3. **Don't invent file paths.** Verify with `ls` / `find` before importing.
4. **Don't invent flags or CLI options.** Run `--help` or read docs first
   (e.g. `flyctl deploy` does not accept `--build-context`; verify before
   prescribing).
5. **Don't restate the user's request as if it were finished.** Show the
   actual diff or the actual command output.
6. **Don't claim "tests pass" without running them.**
7. **Don't propose features the user didn't ask for** in the same change.
   Separate concerns into separate commits or follow-up tickets.
8. **Don't expand scope of a bug fix.** A bug fix touches the smallest area
   that resolves the bug. Refactors go in their own commits with their own
   justification.
9. **Don't write comments that restate code.** Comments explain WHY, not what.
   Default to no comments unless behaviour is non-obvious.
10. **Don't write "kitchen sink" PRs.** If a change touches > 10 files outside
    a single module, stop and propose a split.

---

## 10 · Tenant-awareness (non-negotiable)

Every query, log line, event, metric, error MUST carry `tenantId`:

- DB queries → use `PrismaService.withTenant(ctx, async tx => ...)`. Direct
  `prisma.*` calls are allowed only in webhook handlers and migrations where
  context comes from a trusted source (and that source is documented).
- Logs → include `tenantId`, `correlationId`, `actorId` in the structured
  context.
- Events → NATS subjects include tenant in the metadata, not in the topic.
- Metrics → labels include `tenant` (be mindful of cardinality; bucket if
  needed for shared dashboards).
- Errors → never leak data from one tenant in an error message visible to
  another.

When a webhook arrives from outside (Stripe, SES.HOSPEDAJES), authenticate
the source and derive `tenantId` from your own metadata, not from the payload
without verification.

---

## 11 · Compliance constraints (hard limits)

- **PCI-DSS SAQ A.** PAN never touches our servers. Stripe Elements only.
  If a change would require us to handle PAN, stop and escalate.
- **GDPR.** Guest PII (cardex) is processed under hotel contract. Erasure
  requests must be respected; do not introduce indelible copies.
- **SES.HOSPEDAJES.** Spain requires guest reporting. The producer module
  exists; do not change its semantics without ADR.
- **Verifactu / e-invoicing.** Coming when applicable; don't preemptively
  build it.

---

## 12 · Workflow per change (the loop)

```
1. UNDERSTAND     → re-read this file's relevant sections; grep the repo;
                    confirm scope and DoR.
2. PLAN           → state what files you will touch and why (≤ 5 lines).
3. EDIT           → make the smallest change that satisfies the request.
4. SELF-CHECK     → run typecheck / lint / tests for affected packages.
5. COMMIT         → conventional message; reference the requesting task.
6. PUSH           → to feature branch only.
7. REPORT         → tell the user what changed, what tests ran, what's next.
```

Skip none of these. If a step fails, the loop restarts at step 1.

---

## 13 · When the human is required (escalate)

Hand back to the human when:

- The task requires running a command that's in the §8 forbidden list.
- The task crosses tech-stack boundaries (§3).
- The task needs a third-party admin action (Stripe Dashboard, Keycloak
  realm config, Fly secrets, DNS, GitHub repo settings).
- The task touches production data.
- The task introduces a new external integration (must start with an ADR).
- A test you wrote keeps failing for reasons you can't pinpoint after 2
  honest attempts — say so; don't fake green.
- The user's request contradicts this file's rules or §3 stack.
- Sensitive data (real card numbers, real guest PII, real prod credentials)
  appears in chat — flag and ask for redaction.

When escalating, provide:

- A 2-3 sentence summary of where you got stuck.
- The exact command, file, or decision needed from the human.
- A proposed default if the human says "you decide".

---

## 14 · House style for code

- **TypeScript strict.** No `any`, no `@ts-ignore`. If a type is hard, model
  it; don't escape it.
- **No premature abstraction.** Inline three times before extracting a helper.
- **No defensive code at internal boundaries.** Trust validated inputs.
  Validate at the system edge (HTTP DTOs, webhook bodies, user forms) with
  Zod, then trust downstream.
- **Errors as Nest exceptions** in API (`NotFoundException`,
  `BadRequestException`, `ServiceUnavailableException`, etc.). No `throw new
  Error(...)` in controllers.
- **Idempotency keys** in any state-mutating endpoint that the client can
  retry (payments, postings, check-in).
- **Server actions** in Next.js for forms; minimize client components.
- **No comments restating the code.** WHY only.
- **No emojis in code or commits.** UI strings can have them when asked.

---

## 15 · Common gotchas (learned the hard way)

- `flyctl deploy` does NOT accept `--build-context`. Use
  `--dockerfile apps/<app>/Dockerfile` from the monorepo root.
- The web app and API have separate `fly.toml` files; deploy them with `-c`.
- Stripe Dashboard "Add destination" sometimes blocks event types when the
  endpoint was created in the wrong scope. Use the client-side confirm
  fallback (`POST /payments/stripe/reservations/:id/confirm-setup-intent`)
  rather than fighting webhooks.
- Prisma RLS context lives in a Postgres session variable; the `withTenant`
  wrapper sets it. Forgetting that wrapper returns `[]` silently instead of
  erroring — always verify queries return data when debugging "empty list" bugs.
- NATS JetStream stream names are per-domain; don't reuse a stream across
  unrelated event categories.
- `apps/web-fo/src/app/api/<x>/route.ts` is the server proxy pattern. The
  browser never calls the API directly; it goes through Next.js for session
  injection.
- Migrations: never DROP a column in the same migration that stops writing
  to it. Two-step: stop writing → release → next migration drops.

---

## 16 · Decision hierarchy (when sources conflict)

In order of authority:

1. Active law / regulation (GDPR, PCI, SES.HOSPEDAJES). Cannot be violated.
2. This file (`CLAUDE.md`).
3. `docs/PROJECT.md` — product direction & sprint state.
4. `docs/DELIVERY-LOG.md` — what has actually been done. Use it to ground
   "do we already have X?" questions before implementing anything.
5. Existing ADRs in `docs/adr/`. To override, write a new ADR superseding.
6. The current conversation with the user. If it contradicts the above, ask.
7. Generic best practices.

---

## 17 · Definition of a productive Claude Code session

A session is successful when, at the end:

- The repo is in a green state (typecheck/lint/test pass on touched packages).
- The change is on a feature branch, pushed, with a clear commit history.
- Docs reflect any behavioural change.
- The user knows exactly what's next and what's blocked on them.
- No production-touching action was taken without explicit approval.
- No secrets were committed.
- No drift from §1 mission was introduced.

Anything less, say so explicitly. Be honest. Honesty is faster than rework.

---

_Last updated: 2026-05-16_
_Maintainer: this file is updated via PR like any other. Propose changes; do
not silently mutate the rules mid-session._
