/**
 * Recuperación del admin de Keycloak (Fly: pms-keycloak) sin el password viejo.
 *
 * Keycloak 25 no tiene `bootstrap-admin`, así que reseteamos el password del
 * usuario `admin` del realm `master` directamente en su DB, en el formato
 * PBKDF2-SHA512 que KC valida (lee algorithm + hashIterations de
 * credential_data y re-deriva con key size 512 bits).
 *
 * Este script NO toca la DB — solo calcula el hash y te imprime el SQL para
 * que TÚ lo pegues en `flyctl postgres connect -a pms-keycloak-db`.
 *
 * Uso:
 *   KC_NEW_ADMIN_PASSWORD='un-password-fuerte' \
 *     pnpm tsx scripts/reset-keycloak-admin.ts
 *
 * Variables opcionales:
 *   KC_ADMIN_USERNAME  usuario admin del master realm (default: admin)
 *   KC_ITERATIONS      iteraciones PBKDF2 (default: 210000, el de KC 25)
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const password = process.env.KC_NEW_ADMIN_PASSWORD;
if (!password || password.length < 8) {
  console.error('Falta KC_NEW_ADMIN_PASSWORD (mín. 8 caracteres).');
  process.exit(1);
}
const username = process.env.KC_ADMIN_USERNAME ?? 'admin';
const iterations = Number(process.env.KC_ITERATIONS ?? '210000');

// KC Pbkdf2Sha512: HMAC-SHA512, derived key 512 bits (64 bytes).
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 64, 'sha512');

const secretData = JSON.stringify({
  value: hash.toString('base64'),
  salt: salt.toString('base64'),
  additionalParameters: {},
});
const credentialData = JSON.stringify({
  hashIterations: iterations,
  algorithm: 'pbkdf2-sha512',
  additionalParameters: {},
});

// Escapamos comillas simples para el literal SQL.
const sq = (s: string) => s.replace(/'/g, "''");

console.log('-- Pega TODO esto dentro de `flyctl postgres connect -a pms-keycloak-db`');
console.log('-- (primero: \\c keycloak  para entrar a la base de Keycloak)');
console.log('');
console.log(`UPDATE credential c`);
console.log(`SET secret_data = '${sq(secretData)}',`);
console.log(`    credential_data = '${sq(credentialData)}'`);
console.log(`FROM user_entity u, realm r`);
console.log(`WHERE c.user_id = u.id`);
console.log(`  AND u.realm_id = r.id`);
console.log(`  AND r.name = 'master'`);
console.log(`  AND u.username = '${sq(username)}'`);
console.log(`  AND c.type = 'password';`);
console.log('');
console.log('-- Verifica que afectó 1 fila (UPDATE 1). Luego entra a');
console.log('-- https://pms-keycloak.fly.dev/admin con el password que elegiste.');
