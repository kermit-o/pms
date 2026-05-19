import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { KeycloakAdminService, realmNameFor } from './keycloak-admin.service';

const FETCH_ORIG = globalThis.fetch;

function buildConfig(env: Record<string, string | undefined>) {
  return { get: vi.fn((key: string) => env[key]) };
}

interface MockResp {
  status?: number;
  ok?: boolean;
  json?: () => unknown;
}

function mockSequence(responses: MockResp[]) {
  const fn = vi.fn();
  for (const r of responses) {
    const status = r.status ?? 200;
    fn.mockResolvedValueOnce({
      ok: r.ok ?? status < 400,
      status,
      text: async () => '',
      json: async () => r.json?.() ?? {},
    } as never);
  }
  return fn;
}

describe('realmNameFor', () => {
  it('produces a lowercase slug with prefix', () => {
    expect(realmNameFor('Hotel Berenjena')).toBe('pms-hotel-berenjena');
    expect(realmNameFor('hotel-xyz_12345678')).toBe('pms-hotel-xyz-12345678');
  });
});

describe('KeycloakAdminService.enabled', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as never;
  });
  afterEach(() => {
    globalThis.fetch = FETCH_ORIG;
  });

  it('is false without admin credentials', () => {
    const svc = new KeycloakAdminService(buildConfig({ KEYCLOAK_URL: 'https://kc' }) as never);
    svc.onModuleInit();
    expect(svc.enabled).toBe(false);
  });

  it('is true with all credentials', () => {
    const svc = new KeycloakAdminService(
      buildConfig({
        KEYCLOAK_URL: 'https://kc',
        KEYCLOAK_ADMIN_CLIENT_ID: 'admin-cli',
        KEYCLOAK_ADMIN_CLIENT_SECRET: 's3cr3t',
      }) as never,
    );
    svc.onModuleInit();
    expect(svc.enabled).toBe(true);
  });
});

describe('KeycloakAdminService.provisionTenant', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as never;
  });
  afterEach(() => {
    globalThis.fetch = FETCH_ORIG;
  });

  function buildSvc() {
    const svc = new KeycloakAdminService(
      buildConfig({
        KEYCLOAK_URL: 'https://kc.test',
        KEYCLOAK_ADMIN_CLIENT_ID: 'admin-cli',
        KEYCLOAK_ADMIN_CLIENT_SECRET: 's3cr3t',
        BACKOFFICE_PUBLIC_URL: 'https://fo.test',
      }) as never,
    );
    svc.onModuleInit();
    return svc;
  }

  it('returns disabled when no credentials', async () => {
    const svc = new KeycloakAdminService(buildConfig({ KEYCLOAK_URL: 'https://kc' }) as never);
    svc.onModuleInit();
    const out = await svc.provisionTenant({
      tenantSlug: 'x',
      adminEmail: 'a@b',
      adminFullName: 'A B',
    });
    expect(out).toEqual({ ok: false, reason: 'disabled' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns auth_failed if token endpoint rejects', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'invalid_grant',
      json: async () => ({}),
    } as never);
    const svc = buildSvc();
    const out = await svc.provisionTenant({
      tenantSlug: 'h',
      adminEmail: 'a@b',
      adminFullName: 'A B',
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('auth_failed');
  });

  it('happy path: realm + 2 clients + user + reset-password', async () => {
    globalThis.fetch = mockSequence([
      { json: () => ({ access_token: 'tk', expires_in: 60 }) }, // token
      { status: 404 }, // realm lookup (missing)
      { status: 201 }, // realm create
      { status: 200, json: () => [] }, // pms-api lookup (no client)
      { status: 201 }, // pms-api create
      { status: 200, json: () => [] }, // pms-fo lookup
      { status: 201 }, // pms-fo create
      { status: 200, json: () => [] }, // user lookup (missing)
      { status: 201 }, // user create
      { status: 200, json: () => [{ id: 'kc-user-1' }] }, // user re-lookup
      { status: 204 }, // reset-password
    ]);
    const svc = buildSvc();
    const out = await svc.provisionTenant({
      tenantSlug: 'hotel-berenjena',
      adminEmail: 'owner@hotel.test',
      adminFullName: 'Owner Name',
    });
    expect(out.ok).toBe(true);
    expect(out.realm).toBe('pms-hotel-berenjena');
    expect(out.adminUserId).toBe('kc-user-1');
    expect(out.temporaryPassword).toMatch(/^[0-9a-f]{16}$/);
  });

  it('idempotency: when realm already exists, skips create', async () => {
    globalThis.fetch = mockSequence([
      { json: () => ({ access_token: 'tk', expires_in: 60 }) }, // token
      { status: 200, json: () => ({ realm: 'pms-h' }) }, // realm exists
      { status: 200, json: () => [{ clientId: 'pms-api' }] }, // pms-api exists
      { status: 200, json: () => [{ clientId: 'pms-fo' }] }, // pms-fo exists
      { status: 200, json: () => [{ id: 'kc-existing' }] }, // user exists
      { status: 200, json: () => [{ id: 'kc-existing' }] }, // user re-lookup
      { status: 204 }, // reset-password
    ]);
    const svc = buildSvc();
    const out = await svc.provisionTenant({
      tenantSlug: 'h',
      adminEmail: 'owner@hotel.test',
      adminFullName: 'Owner Name',
    });
    expect(out.ok).toBe(true);
    expect(out.adminUserId).toBe('kc-existing');
  });
});
