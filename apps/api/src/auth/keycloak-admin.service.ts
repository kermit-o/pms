import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';

/**
 * KeycloakAdminService (Sprint 10 W1).
 *
 * Cliente REST contra el Keycloak admin API. Sin SDK npm — fetch directo.
 *
 * Documentación del API: https://www.keycloak.org/docs-api/24.0/rest-api/
 *
 * Endpoints usados:
 *  - POST /realms/master/protocol/openid-connect/token  (auth admin)
 *  - POST /admin/realms                                 (create realm)
 *  - POST /admin/realms/{realm}/clients                 (create client)
 *  - POST /admin/realms/{realm}/users                   (create user)
 *  - PUT  /admin/realms/{realm}/users/{id}/reset-password
 *
 * Token cache en memoria con TTL 50s (el admin token caduca a los 60s
 * por defecto; refrescamos un poco antes).
 *
 * Si `enabled` es false, todos los métodos devuelven `{ ok: false,
 * reason: 'disabled' }` — el consumer (`PublicOnboardingService`) hace
 * fallback al modo manual de S9 W3.
 */
export interface ProvisionResult {
  ok: boolean;
  realm?: string;
  adminUserId?: string;
  temporaryPassword?: string;
  reason?: 'disabled' | 'auth_failed' | 'realm_failed' | 'client_failed' | 'user_failed';
  error?: string;
}

@Injectable()
export class KeycloakAdminService implements OnModuleInit {
  private readonly log = new Logger(KeycloakAdminService.name);
  private baseUrl = '';
  private clientId = '';
  private clientSecret = '';
  private foRedirectBase = '';
  private cachedToken: { access_token: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    this.baseUrl =
      (this.config.get('KEYCLOAK_ADMIN_BASE_URL', { infer: true }) ??
        this.config.get('KEYCLOAK_URL', { infer: true }) ??
        '').replace(/\/$/, '');
    this.clientId = this.config.get('KEYCLOAK_ADMIN_CLIENT_ID', { infer: true }) ?? '';
    this.clientSecret = this.config.get('KEYCLOAK_ADMIN_CLIENT_SECRET', { infer: true }) ?? '';
    this.foRedirectBase =
      this.config.get('KEYCLOAK_FO_REDIRECT_URI_BASE', { infer: true }) ??
      this.config.get('BACKOFFICE_PUBLIC_URL', { infer: true }) ??
      '';
    if (!this.enabled) {
      this.log.log('Keycloak auto-provisioning disabled (no admin credentials)');
    }
  }

  get enabled(): boolean {
    return Boolean(this.baseUrl && this.clientId && this.clientSecret);
  }

  /**
   * Provisión completa idempotente: realm + clients + admin user. Devuelve
   * `{ ok: true, temporaryPassword }` cuando todo está listo, o
   * `{ ok: false, reason, error }` describiendo el paso que falló.
   */
  async provisionTenant(input: {
    tenantSlug: string;
    adminEmail: string;
    adminFullName: string;
  }): Promise<ProvisionResult> {
    if (!this.enabled) return { ok: false, reason: 'disabled' };

    const realm = realmNameFor(input.tenantSlug);

    let token: string;
    try {
      token = await this.obtainAdminToken();
    } catch (err) {
      this.log.warn(`admin auth failed: ${(err as Error).message}`);
      return { ok: false, reason: 'auth_failed', error: (err as Error).message };
    }

    try {
      await this.createRealmIfMissing(token, realm);
    } catch (err) {
      return { ok: false, reason: 'realm_failed', error: (err as Error).message };
    }

    try {
      await this.createClientIfMissing(token, realm, {
        clientId: 'pms-api',
        publicClient: true,
        redirectUris: [],
        bearerOnly: true,
      });
      await this.createClientIfMissing(token, realm, {
        clientId: 'pms-fo',
        publicClient: true,
        redirectUris: this.foRedirectBase ? [`${this.foRedirectBase.replace(/\/$/, '')}/*`] : [],
        bearerOnly: false,
      });
    } catch (err) {
      return { ok: false, reason: 'client_failed', error: (err as Error).message };
    }

    const temporaryPassword = generateTemporaryPassword();
    let adminUserId: string;
    try {
      adminUserId = await this.createOrGetUser(token, realm, {
        email: input.adminEmail,
        fullName: input.adminFullName,
      });
      await this.resetUserPassword(token, realm, adminUserId, temporaryPassword);
    } catch (err) {
      return { ok: false, reason: 'user_failed', error: (err as Error).message };
    }

    this.log.log(`provisioned keycloak realm=${realm} adminUserId=${adminUserId}`);
    return { ok: true, realm, adminUserId, temporaryPassword };
  }

  // -------------------------------------------------------------------------

  private async obtainAdminToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now) {
      return this.cachedToken.access_token;
    }
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const res = await fetch(`${this.baseUrl}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`token_${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = {
      access_token: json.access_token,
      // 10s de margen sobre el TTL real.
      expiresAt: now + (json.expires_in - 10) * 1000,
    };
    return json.access_token;
  }

  private async createRealmIfMissing(token: string, realm: string): Promise<void> {
    const existing = await this.fetch(token, `/admin/realms/${encodeURIComponent(realm)}`);
    if (existing.status === 200) return;
    if (existing.status !== 404) {
      throw new Error(`realm_lookup_${existing.status}`);
    }
    const res = await this.fetch(token, '/admin/realms', {
      method: 'POST',
      body: JSON.stringify({ realm, enabled: true, displayName: realm }),
    });
    if (!res.ok && res.status !== 409) {
      throw new Error(`realm_create_${res.status}: ${await safeText(res)}`);
    }
  }

  private async createClientIfMissing(
    token: string,
    realm: string,
    cfg: { clientId: string; publicClient: boolean; redirectUris: string[]; bearerOnly: boolean },
  ): Promise<void> {
    const list = await this.fetch(
      token,
      `/admin/realms/${encodeURIComponent(realm)}/clients?clientId=${encodeURIComponent(cfg.clientId)}`,
    );
    if (list.status === 200) {
      const arr = (await list.json()) as unknown[];
      if (arr.length > 0) return;
    }
    const res = await this.fetch(token, `/admin/realms/${encodeURIComponent(realm)}/clients`, {
      method: 'POST',
      body: JSON.stringify({
        clientId: cfg.clientId,
        publicClient: cfg.publicClient,
        bearerOnly: cfg.bearerOnly,
        standardFlowEnabled: !cfg.bearerOnly,
        directAccessGrantsEnabled: false,
        redirectUris: cfg.redirectUris,
        enabled: true,
      }),
    });
    if (!res.ok && res.status !== 409) {
      throw new Error(`client_create_${cfg.clientId}_${res.status}: ${await safeText(res)}`);
    }
  }

  private async createOrGetUser(
    token: string,
    realm: string,
    input: { email: string; fullName: string },
  ): Promise<string> {
    const [firstName, ...rest] = input.fullName.trim().split(/\s+/);
    const lastName = rest.join(' ') || firstName!;
    const lookup = await this.fetch(
      token,
      `/admin/realms/${encodeURIComponent(realm)}/users?email=${encodeURIComponent(input.email)}&exact=true`,
    );
    if (lookup.status === 200) {
      const found = (await lookup.json()) as Array<{ id: string }>;
      if (found.length > 0) return found[0]!.id;
    }
    const res = await this.fetch(token, `/admin/realms/${encodeURIComponent(realm)}/users`, {
      method: 'POST',
      body: JSON.stringify({
        username: input.email,
        email: input.email,
        emailVerified: true,
        enabled: true,
        firstName: firstName ?? input.email,
        lastName,
      }),
    });
    if (!res.ok && res.status !== 409) {
      throw new Error(`user_create_${res.status}: ${await safeText(res)}`);
    }
    // Keycloak devuelve el id en el Location header; tras 409 hay que
    // re-consultarlo. En cualquier caso, repetir el lookup.
    const refetch = await this.fetch(
      token,
      `/admin/realms/${encodeURIComponent(realm)}/users?email=${encodeURIComponent(input.email)}&exact=true`,
    );
    const arr = (await refetch.json()) as Array<{ id: string }>;
    if (arr.length === 0) throw new Error('user_lookup_after_create_empty');
    return arr[0]!.id;
  }

  private async resetUserPassword(
    token: string,
    realm: string,
    userId: string,
    password: string,
  ): Promise<void> {
    const res = await this.fetch(
      token,
      `/admin/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/reset-password`,
      {
        method: 'PUT',
        body: JSON.stringify({ type: 'password', value: password, temporary: true }),
      },
    );
    if (!res.ok) throw new Error(`reset_password_${res.status}`);
  }

  private fetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }
}

export function realmNameFor(tenantSlug: string): string {
  return `pms-${tenantSlug}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

function generateTemporaryPassword(): string {
  // 16 hex chars = 64 bits — suficiente para una password temporal de un
  // solo uso (el usuario la cambia en el primer login).
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable>';
  }
}
