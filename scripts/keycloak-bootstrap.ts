/**
 * Keycloak bootstrap idempotente.
 *
 * Crea/actualiza el realm 'pms' con:
 *  - Client confidencial 'pms-api' (con direct-access-grants para tests)
 *  - Realm roles: tenant_admin, front_desk, night_auditor,
 *                 housekeeping_supervisor, housekeeper
 *  - User attribute mapper: atributo 'tenant_id' -> claim 'tenant_id' del JWT
 *  - Usuario demo admin@demo.local con tenant_id = DEMO_TENANT_ID
 *
 * Uso:
 *   pnpm bootstrap:keycloak
 *
 * Las llamadas al Admin REST API son idempotentes (409 = ya existe = OK).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

const envCandidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
for (const path of envCandidates) {
  if (existsSync(path)) {
    loadDotenv({ path });
    break;
  }
}

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const KEYCLOAK_ADMIN = process.env.KEYCLOAK_ADMIN ?? 'admin';
const KEYCLOAK_ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin_dev_password';
const REALM = process.env.KEYCLOAK_REALM ?? 'pms';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'pms-api';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? 'pms-api-dev-secret';
const DEMO_TENANT_ID = '11111111-1111-1111-1111-111111111111';
const DEMO_USER_EMAIL = process.env.DEMO_USER_EMAIL ?? 'admin@demo.local';
const DEMO_USER_PASSWORD = process.env.DEMO_USER_PASSWORD ?? 'demo123';

const REALM_ROLES = [
  'tenant_admin',
  'front_desk',
  'night_auditor',
  'housekeeping_supervisor',
  'housekeeper',
] as const;

const DEMO_USER_ROLES = ['tenant_admin', 'front_desk'] as const;

let adminToken: string | null = null;

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: KEYCLOAK_ADMIN,
      password: KEYCLOAK_ADMIN_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`admin token: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function api(method: string, path: string, body?: unknown): Promise<Response> {
  if (!adminToken) adminToken = await getAdminToken();
  const res = await fetch(`${KEYCLOAK_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // 409 = already exists → tratamos como OK (idempotencia)
  if (!res.ok && res.status !== 409) {
    throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  }
  return res;
}

async function waitForKeycloak(timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${KEYCLOAK_URL}/realms/master`);
      if (res.ok) return;
    } catch {
      /* not yet ready */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Keycloak not ready after ${timeoutMs}ms at ${KEYCLOAK_URL}`);
}

async function ensureRealm(): Promise<void> {
  await api('POST', `/admin/realms`, {
    realm: REALM,
    enabled: true,
    sslRequired: 'external',
    accessTokenLifespan: 900,
    registrationAllowed: false,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
  });
  console.log(`✓ realm '${REALM}' ensured`);
}

interface ClientRepresentation {
  id?: string;
  clientId: string;
  secret?: string;
  enabled?: boolean;
  publicClient?: boolean;
  standardFlowEnabled?: boolean;
  directAccessGrantsEnabled?: boolean;
  serviceAccountsEnabled?: boolean;
  attributes?: Record<string, string>;
}

interface ProtocolMapperRepresentation {
  id?: string;
  name: string;
  protocol: string;
  protocolMapper: string;
  config: Record<string, string>;
}

async function findClient(): Promise<ClientRepresentation | null> {
  const res = await api(
    'GET',
    `/admin/realms/${REALM}/clients?clientId=${encodeURIComponent(CLIENT_ID)}`,
  );
  const arr = (await res.json()) as ClientRepresentation[];
  return arr[0] ?? null;
}

async function ensureClient(): Promise<string> {
  const existing = await findClient();
  const desired: ClientRepresentation = {
    clientId: CLIENT_ID,
    secret: CLIENT_SECRET,
    enabled: true,
    publicClient: false,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: true,
    serviceAccountsEnabled: true,
    attributes: {
      'access.token.lifespan': '900',
    },
  };

  if (!existing) {
    await api('POST', `/admin/realms/${REALM}/clients`, desired);
    console.log(`✓ client '${CLIENT_ID}' created`);
    const created = await findClient();
    if (!created?.id) throw new Error('client created but not found');
    return created.id;
  }

  await api('PUT', `/admin/realms/${REALM}/clients/${existing.id}`, {
    ...existing,
    ...desired,
  });
  console.log(`✓ client '${CLIENT_ID}' updated`);
  return existing.id!;
}

/**
 * Asegura un protocol mapper "User Attribute" que expone el atributo
 * 'tenant_id' del usuario como claim del access token. Idempotente.
 *
 * Keycloak silenciosamente ignora los mappers cuando los pasas como parte
 * del ClientRepresentation, hay que usar el endpoint dedicado.
 */
async function ensureTenantIdMapper(clientUuid: string): Promise<void> {
  const existing = (await (
    await api('GET', `/admin/realms/${REALM}/clients/${clientUuid}/protocol-mappers/models`)
  ).json()) as ProtocolMapperRepresentation[];

  const mapperName = 'tenant_id';
  const desired: ProtocolMapperRepresentation = {
    name: mapperName,
    protocol: 'openid-connect',
    protocolMapper: 'oidc-usermodel-attribute-mapper',
    config: {
      'user.attribute': 'tenant_id',
      'claim.name': 'tenant_id',
      'jsonType.label': 'String',
      'access.token.claim': 'true',
      'id.token.claim': 'true',
      'userinfo.token.claim': 'true',
      multivalued: 'false',
      aggregate_attrs: 'false',
    },
  };

  const found = existing.find((m) => m.name === mapperName);
  if (!found) {
    await api(
      'POST',
      `/admin/realms/${REALM}/clients/${clientUuid}/protocol-mappers/models`,
      desired,
    );
    console.log(`✓ protocol mapper '${mapperName}' created on client`);
    return;
  }
  await api(
    'PUT',
    `/admin/realms/${REALM}/clients/${clientUuid}/protocol-mappers/models/${found.id}`,
    { ...found, ...desired },
  );
  console.log(`✓ protocol mapper '${mapperName}' updated on client`);
}

async function ensureRealmRoles(): Promise<void> {
  for (const name of REALM_ROLES) {
    await api('POST', `/admin/realms/${REALM}/roles`, { name });
  }
  console.log(`✓ realm roles ensured: ${REALM_ROLES.join(', ')}`);
}

interface UserRepresentation {
  id?: string;
  username: string;
  email: string;
  emailVerified?: boolean;
  enabled?: boolean;
  firstName?: string;
  lastName?: string;
  attributes?: Record<string, string[]>;
  credentials?: Array<{ type: string; value: string; temporary: boolean }>;
}

async function findUser(email: string): Promise<UserRepresentation | null> {
  const res = await api(
    'GET',
    `/admin/realms/${REALM}/users?email=${encodeURIComponent(email)}&exact=true`,
  );
  const arr = (await res.json()) as UserRepresentation[];
  return arr[0] ?? null;
}

async function ensureDemoUser(): Promise<string> {
  const existing = await findUser(DEMO_USER_EMAIL);

  const desired: UserRepresentation = {
    username: DEMO_USER_EMAIL,
    email: DEMO_USER_EMAIL,
    emailVerified: true,
    enabled: true,
    firstName: 'Demo',
    lastName: 'Admin',
    attributes: {
      tenant_id: [DEMO_TENANT_ID],
    },
    credentials: [
      { type: 'password', value: DEMO_USER_PASSWORD, temporary: false },
    ],
  };

  if (!existing) {
    await api('POST', `/admin/realms/${REALM}/users`, desired);
    console.log(`✓ user '${DEMO_USER_EMAIL}' created`);
  } else {
    await api('PUT', `/admin/realms/${REALM}/users/${existing.id}`, {
      ...existing,
      ...desired,
    });
    // Reset password explicitly
    await api('PUT', `/admin/realms/${REALM}/users/${existing.id}/reset-password`, {
      type: 'password',
      value: DEMO_USER_PASSWORD,
      temporary: false,
    });
    console.log(`✓ user '${DEMO_USER_EMAIL}' updated`);
  }

  const user = await findUser(DEMO_USER_EMAIL);
  if (!user?.id) throw new Error('demo user not found after upsert');
  return user.id;
}

async function assignRolesToUser(userId: string): Promise<void> {
  // Fetch role representations needed for /role-mappings endpoint
  const roles: Array<{ id: string; name: string }> = [];
  for (const name of DEMO_USER_ROLES) {
    const res = await api('GET', `/admin/realms/${REALM}/roles/${name}`);
    roles.push((await res.json()) as { id: string; name: string });
  }

  await api('POST', `/admin/realms/${REALM}/users/${userId}/role-mappings/realm`, roles);
  console.log(`✓ user '${DEMO_USER_EMAIL}' roles assigned: ${DEMO_USER_ROLES.join(', ')}`);
}

async function main() {
  console.log(`Keycloak bootstrap → ${KEYCLOAK_URL}`);
  await waitForKeycloak();
  await ensureRealm();
  const clientUuid = await ensureClient();
  await ensureTenantIdMapper(clientUuid);
  await ensureRealmRoles();
  const userId = await ensureDemoUser();
  await assignRolesToUser(userId);

  console.log('');
  console.log('───────────────────────────────────────────');
  console.log(`Realm:         ${REALM}`);
  console.log(`Client:        ${CLIENT_ID}`);
  console.log(`Client secret: ${CLIENT_SECRET}`);
  console.log(`Demo user:     ${DEMO_USER_EMAIL}  (password: ${DEMO_USER_PASSWORD})`);
  console.log(`Tenant ID:     ${DEMO_TENANT_ID}`);
  console.log('───────────────────────────────────────────');
  console.log('Test token grant:');
  console.log(`  curl -X POST "${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token" \\`);
  console.log(`    -d "client_id=${CLIENT_ID}" \\`);
  console.log(`    -d "client_secret=${CLIENT_SECRET}" \\`);
  console.log(`    -d "username=${DEMO_USER_EMAIL}" \\`);
  console.log(`    -d "password=${DEMO_USER_PASSWORD}" \\`);
  console.log(`    -d "grant_type=password"`);
}

main().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
