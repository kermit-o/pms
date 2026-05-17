# @pms/web-ibe — Online Booking Engine

Public-facing booking engine for Aubergine PMS. One Next.js app serves
all properties via slug-based routing (`/h/<slug>/...`). No auth.

## Dev

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000 pnpm --filter @pms/web-ibe dev
```

Opens at <http://localhost:3003>.

## Build

```bash
pnpm --filter @pms/web-ibe build
```

Produces a standalone Next.js bundle in `.next/standalone/`.

## Deploy (Fly.io)

```bash
flyctl deploy -c apps/web-ibe/fly.toml --dockerfile apps/web-ibe/Dockerfile
```

## Routes (V1, Sprint 8 W2)

| Route | Description |
|------|-------------|
| `/` | Landing — search by hotel slug |
| `/h/<slug>` | Hotel home + search form |
| `/h/<slug>/availability?...` | Availability results |
| `/h/<slug>/book?...` | Booking flow + Stripe (W3, pending) |
| `/h/<slug>/manage` | Reservation lookup (W4, pending) |
| `/manage` | Generic redirect to hotel selector |

See `docs/SPRINT-8-PLAN.md` and `RUNBOOK.md` §20 for the full plan.
