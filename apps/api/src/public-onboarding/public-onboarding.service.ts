import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'node:crypto';
import type { Prisma } from '@pms/db';
import { PrismaService } from '../db';
import { NotificationsService } from '../notifications';
import type { Env } from '../config/env.schema';
import type { SetupOnboardingDto, StartOnboardingDto } from './public-onboarding.dto';
import {
  signOnboardingToken,
  verifyOnboardingToken,
  type OnboardingTokenPayload,
} from './onboarding-token';

/**
 * Onboarding wizard self-service (Sprint 9 W3).
 *
 * Tres pasos: `start` (envía email con token), `verify` (devuelve setupToken),
 * `setup` (crea property + room types + admin user). Tokens HMAC-firmados
 * con `ONBOARDING_SECRET`; sin tabla nueva.
 *
 * Tenants: para no llenar la DB de tenants huérfanos si nadie confirma el
 * email, **no creamos Tenant en `start`**. El Tenant se crea con identidad
 * propia (slug temporal `pending-<hash(email)>`) recién en `verify`. La
 * fila se actualiza con datos reales en `setup`.
 *
 * Keycloak: V1 no provisiona realm automáticamente — lo dejamos al
 * operador via `scripts/keycloak-bootstrap.ts` (ver RUNBOOK §15). El
 * wizard sí provisiona DB y devuelve credenciales temporales para que el
 * hotel pueda completar el alta una vez Keycloak esté listo.
 */
@Injectable()
export class PublicOnboardingService implements OnModuleInit {
  private readonly log = new Logger(PublicOnboardingService.name);
  private secret = '';
  private ttlHours = 24;
  private backofficeUrl = '';
  private ibeUrl = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    const explicit = this.config.get('ONBOARDING_SECRET', { infer: true });
    if (explicit) {
      this.secret = explicit;
    } else if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new Error(
        'ONBOARDING_SECRET is required in production. Generate one with `openssl rand -hex 32`.',
      );
    } else {
      this.secret = randomBytes(32).toString('hex');
      this.log.warn('ONBOARDING_SECRET not set — using ephemeral dev secret');
    }
    this.ttlHours = this.config.get('ONBOARDING_TOKEN_TTL_HOURS', { infer: true });
    this.backofficeUrl = this.config.get('BACKOFFICE_PUBLIC_URL', { infer: true }) ?? '';
    this.ibeUrl = this.config.get('IBE_PUBLIC_URL', { infer: true }) ?? '';
  }

  async start(input: StartOnboardingDto): Promise<{ queued: true; email: string }> {
    const email = input.email.trim().toLowerCase();
    const exp = Math.floor(Date.now() / 1000) + this.ttlHours * 3600;
    const { token } = signOnboardingToken(
      { kind: 'verify', email, exp },
      this.secret,
    );
    const verifyUrl = this.buildVerifyUrl(token);
    const out = await this.notifications.sendEmail({
      template: 'onboarding_verify',
      to: email,
      locale: input.locale,
      params: {
        email,
        verifyUrl,
        ttlHours: String(this.ttlHours),
      },
    });
    if (!out.ok) {
      this.log.warn(`onboarding start email failed to=${email} reason=${out.error ?? 'unknown'}`);
      throw new ServiceUnavailableException('notification_failed');
    }
    this.log.log(`onboarding started email=${email}`);
    return { queued: true, email };
  }

  async verify(token: string): Promise<{
    tenantId: string;
    setupToken: string;
    expiresAt: string;
    email: string;
  }> {
    const result = verifyOnboardingToken(token, this.secret);
    if (!result.ok) throw new BadRequestException(`token_${result.reason}`);
    if (result.payload.kind !== 'verify') {
      throw new BadRequestException('token_kind_mismatch');
    }
    const email = result.payload.email;
    const pendingSlug = this.pendingSlug(email);

    const tenant = await this.prisma.tenant.upsert({
      where: { slug: pendingSlug },
      create: {
        slug: pendingSlug,
        name: `Pending — ${email}`,
        status: 'TRIAL',
        onboardingStatus: 'EMAIL_VERIFIED',
      },
      update: { onboardingStatus: 'EMAIL_VERIFIED' },
    });

    const exp = Math.floor(Date.now() / 1000) + this.ttlHours * 3600;
    const { token: setupToken } = signOnboardingToken(
      { kind: 'setup', email, tenantId: tenant.id, exp },
      this.secret,
    );

    return {
      tenantId: tenant.id,
      setupToken,
      expiresAt: new Date(exp * 1000).toISOString(),
      email,
    };
  }

  async setup(input: SetupOnboardingDto): Promise<{
    tenantId: string;
    propertyId: string;
    propertySlug: string;
    adminUserId: string;
    adminEmail: string;
    backofficeUrl: string;
    ibeUrl: string;
  }> {
    const result = verifyOnboardingToken(input.token, this.secret);
    if (!result.ok) throw new BadRequestException(`token_${result.reason}`);
    if (result.payload.kind !== 'setup' || !result.payload.tenantId) {
      throw new BadRequestException('token_kind_mismatch');
    }
    const { tenantId, email } = result.payload as Required<
      Pick<OnboardingTokenPayload, 'tenantId' | 'email'>
    > &
      OnboardingTokenPayload;

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new BadRequestException('tenant_missing');
    if (tenant.onboardingStatus === 'SETUP_DONE') {
      throw new BadRequestException('already_done');
    }

    const tenantSlug = this.deriveTenantSlug(input.hotel.name, tenantId);
    const propertyCode = this.derivePropertyCode(input.hotel.name);
    const propertySlug = this.derivePublicSlug(input.hotel.name);

    const created = await this.prisma.$transaction(async (tx) => {
      const t = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          slug: tenantSlug,
          name: input.hotel.name,
          status: 'TRIAL',
          onboardingStatus: 'SETUP_DONE',
        },
      });
      const property = await tx.property.create({
        data: {
          tenantId: t.id,
          code: propertyCode,
          name: input.hotel.name,
          timezone: input.hotel.timezone,
          currency: input.hotel.currency,
          locale: input.hotel.locale,
          publicSlug: propertySlug,
        },
      });
      const roomType = await tx.roomType.create({
        data: {
          tenantId: t.id,
          propertyId: property.id,
          code: 'STD',
          name: 'Standard',
          baseOccupancy: 2,
          maxOccupancy: 2,
          defaultRate: 100,
          defaultCurrency: input.hotel.currency,
        },
      });
      const roomsData: Prisma.RoomCreateManyInput[] = Array.from(
        { length: input.hotel.roomsCount },
        (_, idx) => ({
          tenantId: t.id,
          propertyId: property.id,
          roomTypeId: roomType.id,
          number: String(101 + idx),
          floor: String(Math.floor(idx / 10) + 1),
        }),
      );
      await tx.room.createMany({ data: roomsData });
      const admin = await tx.user.create({
        data: {
          tenantId: t.id,
          email,
          fullName: input.admin.fullName,
          status: 'INVITED',
        },
      });
      return { tenant: t, property, admin };
    });

    this.log.log(
      `onboarding setup done tenant=${created.tenant.id} property=${created.property.id} admin=${created.admin.id}`,
    );

    return {
      tenantId: created.tenant.id,
      propertyId: created.property.id,
      propertySlug,
      adminUserId: created.admin.id,
      adminEmail: email,
      backofficeUrl: this.backofficeUrl,
      ibeUrl: this.ibeUrl ? `${this.ibeUrl}/h/${propertySlug}` : '',
    };
  }

  private buildVerifyUrl(token: string): string {
    const base = this.backofficeUrl || 'http://localhost:3001';
    return `${base.replace(/\/$/, '')}/onboarding/verify?token=${encodeURIComponent(token)}`;
  }

  private pendingSlug(email: string): string {
    const h = createHmac('sha256', 'onboarding-pending-namespace')
      .update(email)
      .digest('hex')
      .slice(0, 12);
    return `pending-${h}`;
  }

  private deriveTenantSlug(hotelName: string, tenantId: string): string {
    const base = slugify(hotelName).slice(0, 40) || 'hotel';
    return `${base}-${tenantId.slice(0, 8)}`;
  }

  private derivePropertyCode(hotelName: string): string {
    const letters = hotelName
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, '')
      .split(/\s+/)
      .filter(Boolean);
    const initials = letters
      .map((w) => w[0]!)
      .join('')
      .slice(0, 4);
    return initials || 'HTL';
  }

  private derivePublicSlug(hotelName: string): string {
    const base = slugify(hotelName).slice(0, 50) || 'hotel';
    const suffix = randomBytes(2).toString('hex');
    return `${base}-${suffix}`;
  }
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
