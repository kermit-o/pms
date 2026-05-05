import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { Env } from '../config/env.schema';
import { ROLES } from './types';
import type { AuthUser, JwtClaims, Role } from './types';

@Injectable()
export class JwtValidatorService implements OnModuleInit {
  private jwks!: JWTVerifyGetKey;
  private issuer!: string;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    const baseUrl = this.config.get('KEYCLOAK_URL', { infer: true });
    const realm = this.config.get('KEYCLOAK_REALM', { infer: true });
    this.issuer = `${baseUrl}/realms/${realm}`;
    this.jwks = createRemoteJWKSet(
      new URL(`${this.issuer}/protocol/openid-connect/certs`),
    );
  }

  async verify(token: string): Promise<AuthUser> {
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
      if (
        err instanceof joseErrors.JWTExpired ||
        err instanceof joseErrors.JWTClaimValidationFailed ||
        err instanceof joseErrors.JWSSignatureVerificationFailed ||
        err instanceof joseErrors.JWSInvalid ||
        err instanceof joseErrors.JOSEError
      ) {
        throw new UnauthorizedException(`Invalid token: ${err.message}`);
      }
      throw err;
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
}
