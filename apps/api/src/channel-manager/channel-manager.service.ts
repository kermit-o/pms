import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelSyncKind, ChannelSyncStatus, Prisma } from '@pms/db';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';
import { ChannelManagerMetrics } from './channel-manager.metrics';
import { SiteMinderProvider } from './providers/siteminder.provider';
import type { ChannelManagerProvider, InboundReservationParsed } from './types';
import type { Env } from '../config/env.schema';

/**
 * ChannelManagerService (Sprint 9 W2).
 *
 * Orquesta tres flujos:
 *  - **push delta on-change** — invocado inline desde reservations cuando
 *    una reserva se crea/cancela. Si la property no tiene provider
 *    configurado, es no-op silencioso.
 *  - **nightly full push** — invocado por night-audit tras CLOSE_DAY. Pasa
 *    365 días de availability + rates al CM.
 *  - **inbound webhook** — recibe bookings OTA del CM y los crea como
 *    Reservation con `source ∈ {BOOKING_COM, EXPEDIA, OTHER_OTA}`. Idempotente
 *    por `externalRef`.
 *
 * Cada operación genera una fila en `ChannelSyncRun`.
 *
 * Sentinel actor `00000000-0000-0000-0000-000000000000` (mismo que IBE)
 * para audit cuando el origen es externo.
 */
@Injectable()
export class ChannelManagerService {
  private readonly log = new Logger(ChannelManagerService.name);
  private readonly publicActor = '00000000-0000-0000-0000-000000000000';
  private readonly providers: Map<string, ChannelManagerProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventbusService,
    private readonly metrics: ChannelManagerMetrics,
    private readonly config: ConfigService<Env, true>,
    siteminder: SiteMinderProvider,
  ) {
    this.providers = new Map<string, ChannelManagerProvider>([[siteminder.id, siteminder]]);
  }

  /**
   * Push de delta tras un cambio puntual (reservation.created / cancelled).
   * Si la property no tiene provider configurado, no-op silencioso. Si
   * falla, registra el sync run como FAILED pero NO propaga la excepción
   * (no queremos romper la creación de la reserva por un fallo del CM).
   */
  async pushDelta(input: {
    propertyId: string;
    arrival: string;
    departure: string;
  }): Promise<void> {
    const property = await this.prisma.property.findUnique({
      where: { id: input.propertyId },
      select: {
        id: true,
        tenantId: true,
        channelManagerProvider: true,
        channelManagerPropertyId: true,
        channelManagerCredentialsRef: true,
      },
    });
    if (!property?.channelManagerProvider) return;
    const provider = this.providers.get(property.channelManagerProvider);
    if (!provider) {
      this.log.warn(`Unknown CM provider="${property.channelManagerProvider}" property=${property.id}`);
      return;
    }
    const dates = enumerateDates(input.arrival, input.departure);
    await this.runSync({
      property,
      provider,
      kind: ChannelSyncKind.PUSH_AVAILABILITY,
      run: async (apiBase, apiKey) => {
        const items = await this.buildAvailabilityItems(property.tenantId, property.id, dates);
        return provider.pushAvailability({
          apiBase,
          apiKey,
          cmPropertyId: property.channelManagerPropertyId!,
          items,
        });
      },
    });
  }

  /**
   * Push nocturno completo (365 días). Llamado por night-audit tras
   * CLOSE_DAY. Reusa pushDelta agrupando todo el rango.
   */
  async runNightlyPush(propertyId: string): Promise<void> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        id: true,
        tenantId: true,
        channelManagerProvider: true,
        channelManagerPropertyId: true,
        channelManagerCredentialsRef: true,
      },
    });
    if (!property?.channelManagerProvider) return;
    const provider = this.providers.get(property.channelManagerProvider);
    if (!provider) return;

    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date();
    horizon.setUTCDate(horizon.getUTCDate() + 365);
    const horizonStr = horizon.toISOString().slice(0, 10);
    const dates = enumerateDates(today, horizonStr);

    await this.runSync({
      property,
      provider,
      kind: ChannelSyncKind.NIGHTLY_FULL,
      run: async (apiBase, apiKey) => {
        const avail = await this.buildAvailabilityItems(property.tenantId, property.id, dates);
        const rates = await this.buildRateItems(property.tenantId, property.id, dates);
        const a = await provider.pushAvailability({
          apiBase,
          apiKey,
          cmPropertyId: property.channelManagerPropertyId!,
          items: avail,
        });
        const r = await provider.pushRates({
          apiBase,
          apiKey,
          cmPropertyId: property.channelManagerPropertyId!,
          items: rates,
        });
        return { pushed: a.pushed + r.pushed, skipped: a.skipped + r.skipped };
      },
    });
  }

  /**
   * Procesa un webhook entrante. Idempotente por `externalRef` — si ya
   * existe una reserva con ese ref para el property, actualiza fechas y
   * estado; si no, crea una nueva.
   */
  async processInboundBooking(input: {
    slug: string;
    rawBody: string;
    headers: Record<string, string | undefined>;
  }): Promise<{
    reservationId: string;
    code: string;
    outcome: 'created' | 'updated';
  }> {
    const property = await this.prisma.property.findFirst({
      where: { publicSlug: input.slug, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        code: true,
        channelManagerProvider: true,
        channelManagerCredentialsRef: true,
      },
    });
    if (!property) {
      this.metrics.webhookRejections.add(1, { provider: 'unknown', reason: 'unknown_property' });
      throw new NotFoundException('property_not_found');
    }
    if (!property.channelManagerProvider) {
      this.metrics.webhookRejections.add(1, { provider: 'unknown', reason: 'no_provider' });
      throw new BadRequestException('cm_not_configured');
    }
    const provider = this.providers.get(property.channelManagerProvider);
    if (!provider) {
      throw new BadRequestException('cm_provider_unknown');
    }
    const secret = this.resolveSecret(property.channelManagerCredentialsRef);
    if (!secret) {
      this.metrics.webhookRejections.add(1, {
        provider: provider.id,
        reason: 'no_secret',
      });
      throw new BadRequestException('cm_secret_missing');
    }
    if (!provider.verifyWebhookSignature(input.rawBody, input.headers, secret)) {
      this.metrics.webhookRejections.add(1, { provider: provider.id, reason: 'bad_signature' });
      throw new ForbiddenException('bad_signature');
    }

    let parsed: InboundReservationParsed;
    try {
      parsed = provider.parseInboundReservation(input.rawBody);
    } catch (err) {
      this.metrics.webhookRejections.add(1, { provider: provider.id, reason: 'parse_error' });
      this.log.warn(`Webhook parse error: ${(err as Error).message}`);
      throw new BadRequestException('payload_invalid');
    }

    const ctx = { tenantId: property.tenantId, actorId: this.publicActor };
    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const roomType = await tx.roomType.findFirst({
        where: { tenantId: property.tenantId, propertyId: property.id, code: parsed.roomTypeCode },
        select: { id: true, defaultCurrency: true },
      });
      if (!roomType) throw new BadRequestException('unknown_room_type');

      const existing = await tx.reservation.findFirst({
        where: {
          tenantId: property.tenantId,
          propertyId: property.id,
          externalRef: parsed.externalRef,
        },
        select: { id: true, code: true, status: true },
      });

      if (existing) {
        const updated = await tx.reservation.update({
          where: { id: existing.id },
          data: {
            arrivalDate: new Date(parsed.arrival),
            departureDate: new Date(parsed.departure),
            adults: parsed.adults,
            children: parsed.children,
            totalAmount: new Prisma.Decimal(parsed.totalAmount),
            currency: parsed.currency,
            specialRequests: parsed.specialRequests,
          },
          select: { id: true, code: true },
        });
        return { reservation: updated, outcome: 'updated' as const };
      }

      const code = `${property.code}-${randomCode()}`;
      const created = await tx.reservation.create({
        data: {
          tenantId: property.tenantId,
          propertyId: property.id,
          code,
          status: 'CONFIRMED',
          arrivalDate: new Date(parsed.arrival),
          departureDate: new Date(parsed.departure),
          adults: parsed.adults,
          children: parsed.children,
          roomTypeId: roomType.id,
          totalAmount: new Prisma.Decimal(parsed.totalAmount),
          currency: parsed.currency,
          source: parsed.source,
          externalRef: parsed.externalRef,
          specialRequests: parsed.specialRequests,
        },
        select: { id: true, code: true },
      });
      return { reservation: created, outcome: 'created' as const };
    });

    // Sync run + métrica
    const now = new Date();
    await this.prisma.channelSyncRun.create({
      data: {
        tenantId: property.tenantId,
        propertyId: property.id,
        provider: provider.id,
        kind: ChannelSyncKind.PULL_RESERVATION,
        status: ChannelSyncStatus.OK,
        startedAt: now,
        completedAt: now,
        externalRef: parsed.externalRef,
        totals: { [result.outcome]: 1 },
      },
    });
    this.metrics.inboundTotal.add(1, {
      provider: provider.id,
      source: parsed.source,
      outcome: result.outcome,
    });

    await this.events.publish('channel.inbound_reservation_received', ctx, {
      reservationId: result.reservation.id,
      propertyId: property.id,
      provider: provider.id,
      externalRef: parsed.externalRef,
      source: parsed.source as 'BOOKING_COM' | 'EXPEDIA' | 'OTHER_OTA',
      outcome: result.outcome,
      arrival: parsed.arrival,
      departure: parsed.departure,
    });

    this.log.log(
      `Inbound ${provider.id} ${result.outcome} reservation=${result.reservation.code} ref=${parsed.externalRef}`,
    );

    return {
      reservationId: result.reservation.id,
      code: result.reservation.code,
      outcome: result.outcome,
    };
  }

  // -------------------------------------------------------------------------

  private async runSync(args: {
    property: { id: string; tenantId: string; channelManagerProvider: string | null };
    provider: ChannelManagerProvider;
    kind: ChannelSyncKind;
    run: (apiBase: string, apiKey: string) => Promise<{ pushed: number; skipped: number }>;
  }): Promise<void> {
    const startedAt = new Date();
    const credentialsRef = (
      args.property as { channelManagerCredentialsRef?: string | null }
    ).channelManagerCredentialsRef;
    const apiBase = this.resolveApiBase(args.provider.id);
    const apiKey = this.resolveSecret(credentialsRef ?? undefined);
    if (!apiBase || !apiKey) {
      this.log.warn(
        `Sync skip provider=${args.provider.id} property=${args.property.id} reason=no_config`,
      );
      await this.recordSync({
        property: args.property,
        provider: args.provider,
        kind: args.kind,
        status: ChannelSyncStatus.SKIPPED,
        startedAt,
        completedAt: new Date(),
        error: 'no_config',
      });
      return;
    }
    const run = await this.prisma.channelSyncRun.create({
      data: {
        tenantId: args.property.tenantId,
        propertyId: args.property.id,
        provider: args.provider.id,
        kind: args.kind,
        status: ChannelSyncStatus.IN_PROGRESS,
        startedAt,
      },
    });
    try {
      const totals = await args.run(apiBase, apiKey);
      const completedAt = new Date();
      await this.prisma.channelSyncRun.update({
        where: { id: run.id },
        data: { status: ChannelSyncStatus.OK, completedAt, totals },
      });
      this.metrics.syncTotal.add(1, { provider: args.provider.id, kind: args.kind, status: 'OK' });
      this.metrics.syncDuration.record(completedAt.getTime() - startedAt.getTime(), {
        provider: args.provider.id,
        kind: args.kind,
      });
      await this.events.publish(
        'channel.sync_completed',
        { tenantId: args.property.tenantId, actorId: this.publicActor },
        {
          syncRunId: run.id,
          propertyId: args.property.id,
          provider: args.provider.id,
          kind: args.kind,
          status: 'OK',
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - startedAt.getTime(),
          totals,
        },
      );
    } catch (err) {
      const completedAt = new Date();
      const message = (err as Error).message;
      await this.prisma.channelSyncRun.update({
        where: { id: run.id },
        data: { status: ChannelSyncStatus.FAILED, completedAt, error: message },
      });
      this.metrics.syncTotal.add(1, {
        provider: args.provider.id,
        kind: args.kind,
        status: 'FAILED',
      });
      this.log.warn(
        `Sync FAILED provider=${args.provider.id} property=${args.property.id} error=${message}`,
      );
    }
  }

  private async recordSync(args: {
    property: { id: string; tenantId: string };
    provider: ChannelManagerProvider;
    kind: ChannelSyncKind;
    status: ChannelSyncStatus;
    startedAt: Date;
    completedAt: Date;
    error?: string | null;
  }): Promise<void> {
    await this.prisma.channelSyncRun.create({
      data: {
        tenantId: args.property.tenantId,
        propertyId: args.property.id,
        provider: args.provider.id,
        kind: args.kind,
        status: args.status,
        startedAt: args.startedAt,
        completedAt: args.completedAt,
        error: args.error,
      },
    });
    this.metrics.syncTotal.add(1, {
      provider: args.provider.id,
      kind: args.kind,
      status: args.status,
    });
  }

  /**
   * Disponibilidad por roomType y fecha (overlap reservations vs total
   * rooms). V1: single roomType heuristic; misma idea que el IBE.
   */
  private async buildAvailabilityItems(
    tenantId: string,
    propertyId: string,
    dates: string[],
  ) {
    if (dates.length === 0) return [];
    const ctx = { tenantId, actorId: this.publicActor };
    return this.prisma.withTenant(ctx, async (tx) => {
      const roomTypes = await tx.roomType.findMany({
        where: { tenantId, propertyId },
        select: { id: true, code: true },
      });
      const rooms = await tx.room.findMany({
        where: { tenantId, propertyId, deletedAt: null, isOutOfOrder: false },
        select: { roomTypeId: true },
      });
      const totals = new Map<string, number>();
      for (const r of rooms) {
        totals.set(r.roomTypeId, (totals.get(r.roomTypeId) ?? 0) + 1);
      }
      const items: { roomTypeCode: string; date: string; available: number }[] = [];
      for (const rt of roomTypes) {
        const total = totals.get(rt.id) ?? 0;
        for (const date of dates) {
          const next = new Date(date);
          next.setUTCDate(next.getUTCDate() + 1);
          const nextStr = next.toISOString().slice(0, 10);
          const overlapping = await tx.reservation.count({
            where: {
              tenantId,
              propertyId,
              roomTypeId: rt.id,
              status: { in: ['CONFIRMED', 'CHECKED_IN', 'PENDING'] },
              arrivalDate: { lt: new Date(nextStr) },
              departureDate: { gt: new Date(date) },
            },
          });
          items.push({
            roomTypeCode: rt.code,
            date,
            available: Math.max(0, total - overlapping),
          });
        }
      }
      return items;
    });
  }

  /**
   * Rate items por roomType, ratePlan y fecha. V1: tomamos el
   * `defaultRate` del RoomType si no hay RatePlan explícito.
   */
  private async buildRateItems(tenantId: string, propertyId: string, dates: string[]) {
    if (dates.length === 0) return [];
    const ctx = { tenantId, actorId: this.publicActor };
    return this.prisma.withTenant(ctx, async (tx) => {
      const roomTypes = await tx.roomType.findMany({
        where: { tenantId, propertyId },
        select: { id: true, code: true, defaultRate: true, defaultCurrency: true },
      });
      const ratePlans = await tx.ratePlan.findMany({
        where: { tenantId, propertyId },
        select: { id: true, code: true },
        take: 1,
      });
      const ratePlanCode = ratePlans[0]?.code ?? 'BAR';
      const items: {
        roomTypeCode: string;
        ratePlanCode: string;
        date: string;
        amount: string;
        currency: string;
      }[] = [];
      for (const rt of roomTypes) {
        for (const date of dates) {
          items.push({
            roomTypeCode: rt.code,
            ratePlanCode,
            date,
            amount: rt.defaultRate.toString(),
            currency: rt.defaultCurrency,
          });
        }
      }
      return items;
    });
  }

  private resolveApiBase(providerId: string): string | undefined {
    if (providerId === 'siteminder') {
      return this.config.get('CM_SITEMINDER_API_BASE', { infer: true });
    }
    return undefined;
  }

  private resolveSecret(ref: string | undefined | null): string | undefined {
    if (!ref) {
      return this.config.get('CM_SITEMINDER_HMAC_SECRET', { infer: true });
    }
    // V1: ref es el nombre de la env var (ej. CM_SITEMINDER_HMAC_SECRET).
    // V2: ref será un alias en un secret manager.
    return (
      this.config.get(ref as keyof Env, { infer: true }) as unknown as string | undefined
    );
  }
}

function enumerateDates(arrival: string, departure: string): string[] {
  const out: string[] = [];
  const start = new Date(arrival);
  const end = new Date(departure);
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function randomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
