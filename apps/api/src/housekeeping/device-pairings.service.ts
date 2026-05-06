import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type { AuthUser } from '../auth';
import { JwtValidatorService, PAIRING_TOKEN_ISSUER } from '../auth/jwt-validator.service';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../db';
import type { MintPairingDto, RedeemPairingDto } from './device-pairings.dto';
import { HousekeepingMetrics } from './metrics';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I — facil de leer en QR.
const CODE_LENGTH = 12;
const ROLES_FOR_PAIRED_DEVICE = ['housekeeper'] as const;

/**
 * Device pairings service. Sprint 4 W4.
 *
 * Flujo: el supervisor llama mint() autenticado y obtiene un codigo de 12
 * chars con TTL ~2 min y un payload QR (URL absoluta opcional + tenantId +
 * code). La camarera escanea el QR desde la PWA, llama redeem() con
 * (tenantId, code) sin auth y recibe un JWT HMAC HS256 de ~12 h emitido por
 * la API. Ese JWT vive como cookie y JwtValidatorService lo acepta como
 * segundo issuer ('aubergine-pairing').
 */
@Injectable()
export class DevicePairingsService {
  private readonly log = new Logger(DevicePairingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtValidatorService,
    private readonly config: ConfigService<Env, true>,
    private readonly metrics: HousekeepingMetrics,
  ) {}

  async mint(user: AuthUser, correlationId: string, input: MintPairingDto): Promise<MintedPairing> {
    const ctx = { tenantId: user.tenantId, actorId: user.sub, correlationId };
    const defaultTtl = this.config.get('PAIRING_CODE_TTL_SECONDS', { infer: true }) ?? 120;
    const ttlSeconds = input.ttlSeconds ?? defaultTtl;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const row = await this.prisma.withTenant(ctx, async (tx) => {
      // Validar que el targetUser pertenece al mismo tenant. RLS lo hace
      // implicitamente en el insert pero un check explicito da mejor 404.
      const target = await tx.user.findFirst({
        where: { id: input.targetUserId, deletedAt: null },
        select: { id: true, email: true },
      });
      if (!target) {
        throw new NotFoundException(`User ${input.targetUserId} not found in tenant`);
      }

      // Reintenta hasta 3 veces si hay colision improbable de codigo.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const code = generateCode();
        try {
          return await tx.devicePairing.create({
            data: {
              tenantId: user.tenantId,
              code,
              targetUserId: input.targetUserId,
              issuedByUserId: user.sub,
              expiresAt,
            },
          });
        } catch (err) {
          if (isUniqueConstraintError(err) && attempt < 2) continue;
          throw err;
        }
      }
      throw new Error('Unreachable: pairing code retries exhausted');
    });

    this.metrics.pairingsMinted.add(1, { tenant: row.tenantId });

    return {
      id: row.id,
      code: row.code,
      tenantId: row.tenantId,
      targetUserId: row.targetUserId,
      expiresAt: row.expiresAt.toISOString(),
      qrPayload: buildQrPayload(row.tenantId, row.code),
    };
  }

  async redeem(correlationId: string, input: RedeemPairingDto): Promise<RedeemedPairing> {
    const ctx = { tenantId: input.tenantId, actorId: null, correlationId };

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const row = await tx.devicePairing.findFirst({
        where: { code: input.code, tenantId: input.tenantId },
      });
      if (!row) {
        this.metrics.pairingsRedeemed.add(1, {
          tenant: input.tenantId,
          outcome: 'not_found',
        });
        throw new NotFoundException('Pairing code not found');
      }
      if (row.redeemedAt) {
        this.metrics.pairingsRedeemed.add(1, {
          tenant: input.tenantId,
          outcome: 'already',
        });
        throw new ConflictException('Pairing code already redeemed');
      }
      if (row.expiresAt.getTime() < Date.now()) {
        this.metrics.pairingsRedeemed.add(1, {
          tenant: input.tenantId,
          outcome: 'expired',
        });
        throw new UnauthorizedException('Pairing code expired');
      }
      const target = await tx.user.findFirst({
        where: { id: row.targetUserId, deletedAt: null },
        select: { id: true, email: true },
      });
      if (!target) throw new NotFoundException('Target user disappeared');

      const jti = randomUUID();
      await tx.devicePairing.update({
        where: { id: row.id },
        data: { redeemedAt: new Date(), redeemedTokenJti: jti },
      });
      return { row, target, jti };
    });

    const ttlHours = this.config.get('PAIRING_TOKEN_TTL_HOURS', { infer: true });
    const expSeconds = Math.floor(Date.now() / 1000) + ttlHours * 3600;
    const token = await new SignJWT({
      tenant_id: input.tenantId,
      email: result.target.email,
      roles: [...ROLES_FOR_PAIRED_DEVICE],
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(PAIRING_TOKEN_ISSUER)
      .setSubject(result.target.id)
      .setIssuedAt()
      .setJti(result.jti)
      .setExpirationTime(expSeconds)
      .sign(this.jwt.getPairingSecret());

    this.metrics.pairingsRedeemed.add(1, {
      tenant: input.tenantId,
      outcome: 'success',
    });

    return {
      token,
      expiresAt: new Date(expSeconds * 1000).toISOString(),
      user: {
        sub: result.target.id,
        email: result.target.email,
        tenantId: input.tenantId,
        roles: [...ROLES_FOR_PAIRED_DEVICE],
      },
    };
  }
}

export interface MintedPairing {
  id: string;
  code: string;
  tenantId: string;
  targetUserId: string;
  expiresAt: string;
  qrPayload: string;
}

export interface RedeemedPairing {
  token: string;
  expiresAt: string;
  user: {
    sub: string;
    email: string;
    tenantId: string;
    roles: string[];
  };
}

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return code;
}

function buildQrPayload(tenantId: string, code: string): string {
  // Formato: "aubergine-pairing:v1?tenantId=...&code=...". El frontend
  // PWA reconoce este scheme cuando se abre desde el escaner del telefono.
  const params = new URLSearchParams({ tenantId, code });
  return `aubergine-pairing:v1?${params.toString()}`;
}

function isUniqueConstraintError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  return code === 'P2002';
}
