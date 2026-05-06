import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { createRemoteJWKSet, decodeJwt, errors as joseErrors, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { Env } from '../config/env.schema';
import { ROLES } from './types';
import type { AuthUser, JwtClaims, Role } from './types';

export const PAIRING_TOKEN_ISSUER = 'aubergine-pairing';

/**
 * Verificador unificado de bearer tokens.
 *
 * Soporta dos issuers:
 *   1. Keycloak (Sprint 1+): JWKS remoto, RS256.
 *   2. Pairing tokens HSK (Sprint 4 W4): HMAC HS256 firmado por la API con
 *      PAIRING_SECRET. iss === 'aubergine-pairing'.
 *
 * Decidimos cual via mirando el claim iss del token decodificado sin verificar
 * (decodeJwt) y luego ejecutamos la verify correcta.
 */
@Injectable()
export class JwtValidatorService implements OnModuleInit {
  private jwks!: JWTVerifyGetKey;
  private issuer!: string;
  private pairingSecret!: Uint8Array;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    const baseUrl = this.config.get('KEYCLOAK_URL', { infer: true });
    const realm = this.config.get('KEYCLOAK_REALM', { infer: true });
    this.issuer = `${baseUrl}/realms/${realm}`;
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/protocol/openid-connect/certs`));

    const configured = this.config.get('PAIRING_SECRET', { infer: true });
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    if (configured) {
      this.pairingSecret = new TextEncoder().encode(configured);
    } else if (nodeEnv === 'production') {
      throw new Error('PAIRING_SECRET is required in production');
    } else {
      // Dev/test: clave efimera por proceso. Los pairings emitidos no
      // sobreviven a un reinicio, lo cual es OK para flujos cortos.
      this.pairingSecret = randomBytes(48);
    }
  }

  getPairingSecret(): Uint8Array {
    return this.pairingSecret;
  }

  async verify(token: string): Promise<AuthUser> {
    const peek = safeDecodeIssuer(token);
    if (peek === PAIRING_TOKEN_ISSUER) {
      return this.verifyPairing(token);
    }
    return this.verifyKeycloak(token);
  }

  private async verifyKeycloak(token: string): Promise<AuthUser> {
    let payload: JwtClaims;
    try {
      const result = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        // Keycloak por defecto emite aud='account' o el client_id; no validamos
        // audience explicitamente — confiamos en issuer + signature. Cuando
        // anadamos audience mapper en el cliente, activamos audience aqui.
      });
      payload = result.payload as unknown as JwtClaims;
    } catch (err) {
      throw mapJoseError(err);
    }

    if (!payload.sub) {
      throw new UnauthorizedException('Token missing sub');
    }
    if (!payload.tenant_id) {
      throw new UnauthorizedException('Token missing tenant_id claim');
    }

    const allRoles = payload.realm_access?.roles ?? [];
    const roles: Role[] = allRoles.filter((r): r is Role =>
      (ROLES as readonly string[]).includes(r),
    );

    return {
      sub: payload.sub,
      email: payload.email ?? payload.preferred_username ?? '',
      tenantId: payload.tenant_id,
      roles,
    };
  }

  private async verifyPairing(token: string): Promise<AuthUser> {
    let payload: PairingClaims;
    try {
      const result = await jwtVerify(token, this.pairingSecret, {
        issuer: PAIRING_TOKEN_ISSUER,
      });
      payload = result.payload as unknown as PairingClaims;
    } catch (err) {
      throw mapJoseError(err);
    }
    if (!payload.sub) throw new UnauthorizedException('Pairing token missing sub');
    if (!payload.tenant_id) throw new UnauthorizedException('Pairing token missing tenant_id');

    const allRoles = payload.roles ?? [];
    const roles: Role[] = allRoles.filter((r): r is Role =>
      (ROLES as readonly string[]).includes(r),
    );

    return {
      sub: payload.sub,
      email: payload.email ?? '',
      tenantId: payload.tenant_id,
      roles,
    };
  }
}

interface PairingClaims {
  sub: string;
  email?: string;
  tenant_id?: string;
  roles?: string[];
  iss: string;
  exp: number;
  iat: number;
}

function safeDecodeIssuer(token: string): string | null {
  try {
    const decoded = decodeJwt(token);
    return typeof decoded.iss === 'string' ? decoded.iss : null;
  } catch {
    return null;
  }
}

function mapJoseError(err: unknown): Error {
  if (
    err instanceof joseErrors.JWTExpired ||
    err instanceof joseErrors.JWTClaimValidationFailed ||
    err instanceof joseErrors.JWSSignatureVerificationFailed ||
    err instanceof joseErrors.JWSInvalid ||
    err instanceof joseErrors.JOSEError
  ) {
    return new UnauthorizedException(`Invalid token: ${err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}
