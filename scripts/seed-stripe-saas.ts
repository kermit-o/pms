/**
 * Crea el Product + Price del SaaS (Aubergine PMS) en Stripe vía API.
 *
 * Idempotente: usa lookup_key para el Price y busca por nombre para el
 * Product. Si ya existe, no lo recrea — solo imprime el ID.
 *
 * Uso (con clave TEST, desde la raíz del monorepo):
 *   STRIPE_SECRET_KEY=sk_test_... \
 *     pnpm --filter @pms/api exec tsx ../../scripts/seed-stripe-saas.ts
 *
 * Uso (con clave LIVE, cuando vayas a producción de verdad):
 *   STRIPE_SECRET_KEY=sk_live_... \
 *     pnpm --filter @pms/api exec tsx ../../scripts/seed-stripe-saas.ts
 *
 * Variables opcionales:
 *   SAAS_PRICE_EUR  Importe mensual en euros (default: 149)
 *   SAAS_PRODUCT_NAME  Nombre del producto (default: "Aubergine PMS")
 *
 * Al final imprime el SAAS_STRIPE_PRICE_ID listo para `flyctl secrets set`.
 */
import Stripe from 'stripe';

const PRODUCT_NAME = process.env.SAAS_PRODUCT_NAME ?? 'Aubergine PMS';
const PRICE_EUR = Number(process.env.SAAS_PRICE_EUR ?? '149');
const LOOKUP_KEY = `aubergine_pms_monthly_${PRICE_EUR}eur`;

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('Falta STRIPE_SECRET_KEY en el entorno.');
    process.exit(1);
  }
  if (!Number.isFinite(PRICE_EUR) || PRICE_EUR <= 0) {
    console.error(`SAAS_PRICE_EUR inválido: ${PRICE_EUR}`);
    process.exit(1);
  }

  const stripe = new Stripe(key, { apiVersion: '2024-11-20.acacia' });
  const mode = key.startsWith('sk_live_') ? 'LIVE' : 'TEST';
  console.log(`Stripe mode: ${mode}`);
  console.log(`Producto: "${PRODUCT_NAME}" — ${PRICE_EUR}€/mes`);

  const existingPrices = await stripe.prices.list({
    lookup_keys: [LOOKUP_KEY],
    expand: ['data.product'],
    limit: 1,
  });
  if (existingPrices.data.length > 0) {
    const price = existingPrices.data[0]!;
    const product = price.product as Stripe.Product;
    console.log('Ya existe — no se recrea.');
    console.log(`  Product ID: ${product.id}`);
    console.log(`  Price ID:   ${price.id}`);
    printSecretsCommand(price.id);
    return;
  }

  const productList = await stripe.products.search({
    query: `name:"${PRODUCT_NAME}" AND active:"true"`,
    limit: 1,
  });
  const product =
    productList.data[0] ??
    (await stripe.products.create({
      name: PRODUCT_NAME,
      description: 'Suscripción mensual a Aubergine PMS (SaaS para boutique hotels).',
    }));
  console.log(`Product ${productList.data[0] ? 'existente' : 'creado'}: ${product.id}`);

  const price = await stripe.prices.create({
    product: product.id,
    currency: 'eur',
    unit_amount: PRICE_EUR * 100,
    recurring: { interval: 'month' },
    lookup_key: LOOKUP_KEY,
    nickname: `${PRICE_EUR}€/mes`,
  });
  console.log(`Price creado: ${price.id}`);

  printSecretsCommand(price.id);
}

function printSecretsCommand(priceId: string) {
  console.log('');
  console.log('--- Pega esto en tu shell con el resto de secrets de billing ---');
  console.log(`SAAS_STRIPE_PRICE_ID=${priceId}`);
  console.log('---');
}

main().catch((err) => {
  console.error('Falló:', err);
  process.exit(1);
});
