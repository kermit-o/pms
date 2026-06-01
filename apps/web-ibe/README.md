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

## Routes

| Route                        | Description                                              |
| ---------------------------- | -------------------------------------------------------- |
| `/`                          | Landing — search by hotel slug                           |
| `/h/<slug>`                  | Hotel home + search form                                 |
| `/h/<slug>/availability?...` | Availability results                                     |
| `/h/<slug>/book?...`         | Booking flow (form → POST reserva)                       |
| `/h/<slug>/book/<code>`      | Confirmación de reserva + captura tarjeta Stripe (modal) |
| `/h/<slug>/manage`           | Reservation lookup (code + lastName)                     |
| `/manage`                    | Generic redirect to hotel selector                       |

### Probar el flujo Stripe en local

Con `STRIPE_SECRET_KEY=sk_test_...` + `STRIPE_PUBLISHABLE_KEY=pk_test_...` en el `.env` del API, la captura de tarjeta funciona en modo test. Tarjetas de prueba habituales:

| PAN                   | Caso                              |
| --------------------- | --------------------------------- |
| `4242 4242 4242 4242` | Éxito directo                     |
| `4000 0025 0000 3155` | Requiere 3DS (modal de challenge) |
| `4000 0000 0000 0002` | Rechazo (`card_declined`)         |

CVC: cualquiera. Caducidad: cualquier fecha futura. ZIP: cualquiera.

Sin `STRIPE_*` configurado, el endpoint `/api/setup-intent` responde 503 y el operador del hotel cae al flujo manual (marcar garantía con últimos 4 a mano).
