/**
 * Roles del dominio que entiende la API. Vienen del realm de Keycloak.
 * Si Keycloak emite roles distintos se ignoran en authorization (no se mapean).
 */
export const ROLES = [
  'tenant_admin',
  'front_desk',
  'night_auditor',
  'housekeeping_supervisor',
  'housekeeper',
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Usuario autenticado, construido a partir de los claims del JWT validado.
 */
export interface AuthUser {
  /** Keycloak user id (sub claim). Usado como actorId para audit. */
  sub: string;
  email: string;
  /** Tenant del usuario, viene del claim 'tenant_id' (mapper en Keycloak). */
  tenantId: string;
  roles: Role[];
}

export interface JwtClaims {
  sub: string;
  email?: string;
  preferred_username?: string;
  tenant_id?: string;
  realm_access?: { roles?: string[] };
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
}
