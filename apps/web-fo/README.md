# @pms/web-fo — Aubergine Front Office

Next.js 15 + React 19 + Tailwind 3 + shadcn/ui (a integrar incrementalmente).

UI desktop-first para recepción: reservas, check-in/out, folio, cardex y
copiloto conversacional. Sprint 2 alcance completo en
[`docs/SPRINT-2-PLAN.md`](../../docs/SPRINT-2-PLAN.md) §3.

## Estado actual

Scaffold inicial (layout, página de bienvenida, configuración Tailwind, paleta
de marca `aubergine-*`). El resto de páginas se construyen semana a semana
según el plan.

## Desarrollo

```bash
pnpm install
pnpm --filter @pms/web-fo dev    # http://localhost:3001
```

Por defecto la API se asume en `http://localhost:3000` (configurable via
`NEXT_PUBLIC_API_URL` cuando se introduzca el cliente HTTP).

## shadcn/ui

Se introduce on-demand al añadir cada componente (no como dependencia global).
Comando estándar:

```bash
pnpm dlx shadcn@latest add button input dialog table
```
