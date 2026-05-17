import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  GuaranteeStatus,
  GuaranteeType,
  Prisma,
  ReservationSource,
  ReservationStatus,
} from '@pms/db';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../db';
import { EventbusService } from '../eventbus';
import { NotificationsService } from '../notifications';
import { StripeService } from '../payments/stripe.service';
import type { AuthUser } from '../auth';
import type { Env } from '../config/env.schema';
import type {
  AvailabilityQuery,
  CancelPublicReservationDto,
  CreatePublicReservationDto,
} from './public-ibe.dto';
import type {
  PublicCancelResult,
  PublicProperty,
  PublicReservationCreateResult,
  PublicReservationView,
  PublicRoomTypeAvailability,
} from './public-ibe.types';

/**
 * API pública del IBE (Sprint 8 W1).
 *
 * No usa AuthGuard / JWT. La verificación de identidad es:
 *  - Lectura por slug: cualquiera con el slug puede ver el property
 *    (el slug es opaco; el hotel decide publicar).
 *  - Lectura/cancelación de una reserva: requiere `code + lastName`
 *    (verificación débil pero estándar en hotelería; rate-limit es
 *    el cinturón de seguridad).
 *
 * Sentinel actor para audit: `00000000-0000-0000-0000-000000000000` —
 * representa "huésped público desde el IBE". El correlationId que llega
 * del frontend (request id de Fastify) basta para trazar.
 */
@Injectable()
export class PublicIbeService {
  private readonly log = new Logger(PublicIbeService.name);
  private readonly publicActor = '00000000-0000-0000-0000-000000000000';

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventbusService,
    private readonly stripe: StripeService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async getProperty(slug: string): Promise<PublicProperty> {
    const property = await this.findPublishedProperty(slug);
    return {
      slug,
      name: property.name,
      timezone: property.timezone,
      currency: property.currency,
      locale: property.locale,
    };
  }

  async searchAvailability(
    slug: string,
    query: AvailabilityQuery,
  ): Promise<{ property: PublicProperty; results: PublicRoomTypeAvailability[] }> {
    const property = await this.findPublishedProperty(slug);
    const arrival = new Date(query.arrival);
    const departure = new Date(query.departure);
    if (arrival >= departure) {
      throw new BadRequestException('arrival must be before departure');
    }
    const nights = Math.max(
      1,
      Math.round((departure.getTime() - arrival.getTime()) / 86_400_000),
    );

    const ctx = this.publicCtx(property.tenantId);
    const results = await this.prisma.withTenant(ctx, async (tx) => {
      const types = await tx.roomType.findMany({
        where: { propertyId: property.id, deletedAt: null },
        orderBy: { defaultRate: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          baseOccupancy: true,
          maxOccupancy: true,
          defaultRate: true,
          defaultCurrency: true,
        },
      });
      const rooms = await tx.room.findMany({
        where: { propertyId: property.id, deletedAt: null, isOutOfOrder: false },
        select: { id: true, roomTypeId: true },
      });
      const overlapping = await tx.reservation.findMany({
        where: {
          propertyId: property.id,
          deletedAt: null,
          status: {
            in: [
              ReservationStatus.PENDING,
              ReservationStatus.CONFIRMED,
              ReservationStatus.CHECKED_IN,
            ],
          },
          arrivalDate: { lt: departure },
          departureDate: { gt: arrival },
        },
        select: { roomTypeId: true },
      });

      const occupiedByType = overlapping.reduce<Record<string, number>>((acc, r) => {
        acc[r.roomTypeId] = (acc[r.roomTypeId] ?? 0) + 1;
        return acc;
      }, {});

      const pax = query.adults + query.children;
      return types
        .filter((t) => t.maxOccupancy >= pax)
        .map((t) => {
          const total = rooms.filter((r) => r.roomTypeId === t.id).length;
          const occupied = occupiedByType[t.id] ?? 0;
          const available = Math.max(0, total - occupied);
          const pricePerNight = Number(t.defaultRate);
          return {
            roomTypeId: t.id,
            code: t.code,
            name: t.name,
            available,
            totalRooms: total,
            maxOccupancy: t.maxOccupancy,
            pricePerNight: pricePerNight.toFixed(2),
            totalForStay: (pricePerNight * nights).toFixed(2),
            currency: t.defaultCurrency ?? property.currency,
            nights,
          };
        })
        .filter((r) => r.totalRooms > 0);
    });

    return {
      property: {
        slug,
        name: property.name,
        timezone: property.timezone,
        currency: property.currency,
        locale: property.locale,
      },
      results,
    };
  }

  async createReservation(
    slug: string,
    input: CreatePublicReservationDto,
  ): Promise<PublicReservationCreateResult> {
    if (!input.guest.gdprConsent) {
      throw new BadRequestException('GDPR consent is required');
    }
    const arrival = new Date(input.arrival);
    const departure = new Date(input.departure);
    if (arrival >= departure) {
      throw new BadRequestException('arrival must be before departure');
    }
    const property = await this.findPublishedProperty(slug);
    const ctx = this.publicCtx(property.tenantId);

    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const roomType = await tx.roomType.findFirst({
        where: { id: input.roomTypeId, propertyId: property.id, deletedAt: null },
        select: {
          id: true,
          code: true,
          name: true,
          maxOccupancy: true,
          defaultRate: true,
          defaultCurrency: true,
        },
      });
      if (!roomType) {
        throw new BadRequestException('roomTypeId not found in this property');
      }
      if (roomType.maxOccupancy < input.occupancy.adults + input.occupancy.children) {
        throw new ConflictException('Occupancy exceeds room type capacity');
      }

      const nights = Math.max(
        1,
        Math.round((departure.getTime() - arrival.getTime()) / 86_400_000),
      );
      const dailyRate = Number(roomType.defaultRate);
      const totalAmount = new Prisma.Decimal((dailyRate * nights).toFixed(2));
      const currency = roomType.defaultCurrency ?? property.currency;

      const guest = await tx.guest.create({
        data: {
          tenantId: property.tenantId,
          firstName: input.guest.firstName,
          lastName: input.guest.lastName,
          email: input.guest.email,
          phone: input.guest.phone ?? null,
          documentType: input.guest.documentType ?? null,
          documentNumber: input.guest.documentNumber ?? null,
          nationality: input.guest.nationality ?? null,
          gdprConsent: input.guest.gdprConsent,
          marketingConsent: input.guest.marketingConsent ?? false,
          attributes: { fromIbe: true } as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      const code = generateCode(property.code);
      const reservation = await tx.reservation.create({
        data: {
          tenantId: property.tenantId,
          propertyId: property.id,
          code,
          status: ReservationStatus.CONFIRMED,
          arrivalDate: arrival,
          departureDate: departure,
          adults: input.occupancy.adults,
          children: input.occupancy.children,
          roomTypeId: roomType.id,
          ratePlanId: input.ratePlanId ?? null,
          totalAmount,
          currency,
          source: ReservationSource.DIRECT,
          specialRequests: input.specialRequests ?? null,
          notes: 'Reserva creada desde IBE público',
          guaranteeType: GuaranteeType.NONE,
          guaranteeStatus: GuaranteeStatus.PENDING,
          guests: {
            create: {
              tenantId: property.tenantId,
              guestId: guest.id,
              isPrimary: true,
            },
          },
          folio: {
            create: {
              tenantId: property.tenantId,
              balance: totalAmount,
              currency,
            },
          },
        },
        select: { id: true, code: true, status: true, totalAmount: true, currency: true },
      });
      return { reservation, roomTypeNameOrCode: roomType.name || roomType.code };
    });
    const roomTypeNameOrCode = result.roomTypeNameOrCode;
    const reservationOut = result.reservation;

    await this.events.publish('reservation.created', ctx, {
      reservationId: reservationOut.id,
      propertyId: property.id,
      code: reservationOut.code,
      source: ReservationSource.DIRECT,
      currency: reservationOut.currency,
      arrivalDate: input.arrival,
      departureDate: input.departure,
      roomTypeId: input.roomTypeId,
      ratePlanId: input.ratePlanId ?? null,
      adults: input.occupancy.adults,
      children: input.occupancy.children,
      totalAmount: reservationOut.totalAmount.toString(),
    });

    this.log.log(`IBE reservation ${reservationOut.code} created for property ${slug}`);

    // Email de confirmación al huésped (best-effort).
    await this.dispatchConfirmation({
      slug,
      hotelName: property.name,
      code: reservationOut.code,
      lastName: input.guest.lastName,
      guestFirstName: input.guest.firstName,
      guestEmail: input.guest.email,
      arrival: input.arrival,
      departure: input.departure,
      roomTypeName: roomTypeNameOrCode,
      totalAmount: reservationOut.totalAmount.toString(),
      currency: reservationOut.currency,
    });

    return {
      code: reservationOut.code,
      status: reservationOut.status,
      arrival: input.arrival,
      departure: input.departure,
      totalAmount: reservationOut.totalAmount.toString(),
      currency: reservationOut.currency,
    };
  }

  async getReservation(
    slug: string,
    code: string,
    lastName: string,
  ): Promise<PublicReservationView> {
    const property = await this.findPublishedProperty(slug);
    const ctx = this.publicCtx(property.tenantId);
    const row = await this.prisma.withTenant(ctx, (tx) =>
      tx.reservation.findFirst({
        where: {
          propertyId: property.id,
          code,
          deletedAt: null,
          guests: {
            some: {
              isPrimary: true,
              guest: { lastName: { equals: lastName, mode: 'insensitive' } },
            },
          },
        },
        include: {
          cancellationPolicy: {
            select: { name: true, hoursBeforeArrival: true, penaltyPct: true },
          },
          roomType: { select: { code: true, name: true } },
          guests: {
            where: { isPrimary: true },
            take: 1,
            select: { guest: { select: { firstName: true, lastName: true, email: true } } },
          },
        },
      }),
    );
    if (!row) throw new NotFoundException('Reservation not found');
    const cancellable = canCancel(row);
    return {
      code: row.code,
      status: row.status,
      arrival: row.arrivalDate.toISOString().slice(0, 10),
      departure: row.departureDate.toISOString().slice(0, 10),
      totalAmount: row.totalAmount.toString(),
      currency: row.currency,
      roomType: row.roomType
        ? { code: row.roomType.code, name: row.roomType.name }
        : { code: '?', name: '?' },
      guest: row.guests[0]!.guest,
      cancellable,
      cancellationPolicy: row.cancellationPolicy
        ? `${row.cancellationPolicy.name}: gratis ${row.cancellationPolicy.hoursBeforeArrival}h antes de llegada; tras ese plazo penalización ${row.cancellationPolicy.penaltyPct}%`
        : null,
    };
  }

  async cancelReservation(
    slug: string,
    code: string,
    input: CancelPublicReservationDto,
  ): Promise<PublicCancelResult> {
    const property = await this.findPublishedProperty(slug);
    const ctx = this.publicCtx(property.tenantId);
    const result = await this.prisma.withTenant(ctx, async (tx) => {
      const existing = await tx.reservation.findFirst({
        where: {
          propertyId: property.id,
          code,
          deletedAt: null,
          guests: {
            some: {
              isPrimary: true,
              guest: { lastName: { equals: input.lastName, mode: 'insensitive' } },
            },
          },
        },
        include: {
          cancellationPolicy: {
            select: { name: true, hoursBeforeArrival: true, penaltyPct: true },
          },
          guests: {
            where: { isPrimary: true },
            take: 1,
            select: { guest: { select: { firstName: true, email: true } } },
          },
        },
      });
      if (!existing) throw new NotFoundException('Reservation not found');
      if (
        existing.status === ReservationStatus.CANCELLED ||
        existing.status === ReservationStatus.CHECKED_OUT ||
        existing.status === ReservationStatus.NO_SHOW
      ) {
        throw new ConflictException(`Reserva en estado ${existing.status} no cancelable`);
      }

      const policy = existing.cancellationPolicy;
      const penalty = computePenalty(
        existing.arrivalDate,
        Number(existing.totalAmount),
        policy,
      );
      if (penalty > 0 && !input.acceptPenalty) {
        throw new ConflictException(
          `Penalización aplicable: ${penalty.toFixed(2)} ${existing.currency}. Confirma con acceptPenalty=true.`,
        );
      }

      const cancelledAt = new Date();
      await tx.reservation.update({
        where: { id: existing.id },
        data: {
          status: ReservationStatus.CANCELLED,
          cancelledAt,
          cancellationReason: 'Cancelada por el huésped desde IBE',
        },
      });

      return {
        id: existing.id,
        code,
        status: 'CANCELLED' as const,
        penalty: penalty.toFixed(2),
        currency: existing.currency,
        policy: policy?.name ?? null,
        cancelledAt,
        guestFirstName: existing.guests[0]?.guest.firstName ?? null,
        guestEmail: existing.guests[0]?.guest.email ?? null,
      };
    });

    await this.events.publish('reservation.cancelled', ctx, {
      reservationId: result.id,
      propertyId: property.id,
      code: result.code,
      reason: 'Cancelada por el huésped desde IBE',
      cancelledAt: result.cancelledAt.toISOString(),
      policyApplied: result.policy,
    });

    if (result.guestEmail && result.guestFirstName) {
      await this.dispatchCancellation({
        hotelName: property.name,
        code: result.code,
        guestFirstName: result.guestFirstName,
        guestEmail: result.guestEmail,
        penalty: result.penalty,
        currency: result.currency,
      });
    }

    return {
      code: result.code,
      status: result.status,
      penalty: result.penalty,
      currency: result.currency,
      policy: result.policy,
    };
  }

  /**
   * Crea (o reusa) un SetupIntent para que el huésped tokenice su tarjeta
   * desde el IBE como garantía. Reutiliza `StripeService.createSetupIntent`
   * con un AuthUser sentinel que representa "huésped público desde IBE".
   * El método del back-office se encarga del resto: crea/reusa Customer +
   * SetupIntent, marca `guaranteeType = CARD_ON_FILE` y devuelve el
   * clientSecret + publishableKey para que el browser monte Stripe Elements.
   */
  async createSetupIntent(
    slug: string,
    code: string,
    lastName: string,
  ): Promise<{ clientSecret: string; publishableKey: string }> {
    const { reservationId, user, correlationId } = await this.resolvePublicReservation(
      slug,
      code,
      lastName,
    );
    return this.stripe.createSetupIntent(user, correlationId, reservationId);
  }

  /**
   * Fallback al webhook (igual que el back-office): tras confirmSetup en
   * el browser, el cliente llama aquí para que el server lea el SI de
   * Stripe y marque la reserva SECURED de forma idempotente.
   */
  async confirmSetupIntent(
    slug: string,
    code: string,
    lastName: string,
  ): Promise<{ status: string; brand: string | null; last4: string | null }> {
    const { reservationId, user, correlationId } = await this.resolvePublicReservation(
      slug,
      code,
      lastName,
    );
    return this.stripe.confirmSetupIntent(user, correlationId, reservationId);
  }

  /**
   * Resuelve `(slug, code, lastName)` -> `(reservation, sentinel user, cid)`.
   * Throws si no encuentra. Reutilizado por los endpoints de Stripe del IBE.
   */
  private async resolvePublicReservation(
    slug: string,
    code: string,
    lastName: string,
  ): Promise<{ reservationId: string; user: AuthUser; correlationId: string }> {
    const property = await this.findPublishedProperty(slug);
    const ctx = this.publicCtx(property.tenantId);
    const reservation = await this.prisma.withTenant(ctx, (tx) =>
      tx.reservation.findFirst({
        where: {
          propertyId: property.id,
          code,
          deletedAt: null,
          guests: {
            some: {
              isPrimary: true,
              guest: { lastName: { equals: lastName, mode: 'insensitive' } },
            },
          },
        },
        select: { id: true },
      }),
    );
    if (!reservation) throw new NotFoundException('Reservation not found');
    const user: AuthUser = {
      sub: this.publicActor,
      tenantId: property.tenantId,
      email: 'ibe@public',
      roles: [],
    };
    return { reservationId: reservation.id, user, correlationId: ctx.correlationId };
  }

  /**
   * Reenvía el email de confirmación al huésped. V1 emite el evento
   * `reservation.confirmation_resend_requested`; el consumer real
   * (Postmark / SendGrid) llega en Sprint 9.
   *
   * Idempotente — se puede llamar varias veces, el rate-limit del
   * endpoint protege contra abuse.
   */
  async resendConfirmation(
    slug: string,
    code: string,
    lastName: string,
  ): Promise<{ queued: true; email: string | null }> {
    const property = await this.findPublishedProperty(slug);
    const ctx = this.publicCtx(property.tenantId);
    const reservation = await this.prisma.withTenant(ctx, (tx) =>
      tx.reservation.findFirst({
        where: {
          propertyId: property.id,
          code,
          deletedAt: null,
          guests: {
            some: {
              isPrimary: true,
              guest: { lastName: { equals: lastName, mode: 'insensitive' } },
            },
          },
        },
        select: {
          id: true,
          code: true,
          arrivalDate: true,
          departureDate: true,
          totalAmount: true,
          currency: true,
          roomType: { select: { code: true, name: true } },
          guests: {
            where: { isPrimary: true },
            take: 1,
            select: { guest: { select: { email: true, firstName: true, lastName: true } } },
          },
        },
      }),
    );
    if (!reservation) throw new NotFoundException('Reservation not found');
    const guest = reservation.guests[0]?.guest;
    const email = guest?.email ?? null;

    // Publicamos evento (catálogo S9 W1) y mandamos email.
    await this.events.publish('reservation.confirmation_resend_requested', ctx, {
      reservationId: reservation.id,
      propertyId: property.id,
      code: reservation.code,
      email,
      source: 'IBE',
      requestedAt: new Date().toISOString(),
    });
    if (email && guest) {
      await this.dispatchConfirmation({
        slug,
        hotelName: property.name,
        code: reservation.code,
        lastName: guest.lastName,
        guestFirstName: guest.firstName,
        guestEmail: email,
        arrival: reservation.arrivalDate.toISOString().slice(0, 10),
        departure: reservation.departureDate.toISOString().slice(0, 10),
        roomTypeName: reservation.roomType?.name || reservation.roomType?.code || '?',
        totalAmount: reservation.totalAmount.toString(),
        currency: reservation.currency,
      });
    }
    this.log.log(
      `Confirmation resend reservationId=${reservation.id} code=${reservation.code} email=${email ?? 'none'}`,
    );
    return { queued: true, email };
  }

  // --------------------------------------------------------------------------

  private async findPublishedProperty(slug: string) {
    const property = await this.prisma.property.findFirst({
      where: {
        publicSlug: slug,
        publishedAt: { not: null },
        deletedAt: null,
      },
      select: {
        id: true,
        tenantId: true,
        code: true,
        name: true,
        timezone: true,
        currency: true,
        locale: true,
      },
    });
    if (!property) throw new NotFoundException(`Hotel ${slug} not found or not published`);
    return property;
  }

  private publicCtx(tenantId: string) {
    return {
      tenantId,
      actorId: this.publicActor,
      correlationId: `ibe-${randomBytes(6).toString('hex')}`,
    };
  }

  // --------------------------------------------------------------------------
  // Email dispatchers (Sprint 9 W1) — best-effort, jamás bloquean al usuario.
  // --------------------------------------------------------------------------

  private async dispatchConfirmation(p: {
    slug: string;
    hotelName: string;
    code: string;
    lastName: string;
    guestFirstName: string;
    guestEmail: string;
    arrival: string;
    departure: string;
    roomTypeName: string;
    totalAmount: string;
    currency: string;
  }): Promise<void> {
    const ibe = this.config.get('IBE_PUBLIC_URL', { infer: true }) ?? '';
    const manageUrl = ibe
      ? `${ibe.replace(/\/$/, '')}/h/${encodeURIComponent(p.slug)}/manage?code=${encodeURIComponent(p.code)}&lastName=${encodeURIComponent(p.lastName)}`
      : '';
    try {
      await this.notifications.sendEmail({
        template: 'reservation_confirmation',
        to: p.guestEmail,
        locale: 'es',
        params: {
          code: p.code,
          hotelName: p.hotelName,
          guestFirstName: p.guestFirstName,
          arrival: p.arrival,
          departure: p.departure,
          roomTypeName: p.roomTypeName,
          totalAmount: p.totalAmount,
          currency: p.currency,
          manageUrl,
          brand: { name: p.hotelName },
        },
      });
    } catch (err) {
      this.log.warn(`Email confirmation dispatch failed for ${p.code}: ${(err as Error).message}`);
    }
  }

  private async dispatchCancellation(p: {
    hotelName: string;
    code: string;
    guestFirstName: string;
    guestEmail: string;
    penalty: string;
    currency: string;
  }): Promise<void> {
    try {
      await this.notifications.sendEmail({
        template: 'reservation_cancelled',
        to: p.guestEmail,
        locale: 'es',
        params: {
          code: p.code,
          hotelName: p.hotelName,
          guestFirstName: p.guestFirstName,
          penalty: p.penalty,
          currency: p.currency,
          brand: { name: p.hotelName },
        },
      });
    } catch (err) {
      this.log.warn(`Email cancellation dispatch failed for ${p.code}: ${(err as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateCode(propertyCode: string): string {
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `${propertyCode.slice(0, 5).toUpperCase()}-${suffix}`;
}

function canCancel(row: { status: ReservationStatus }): boolean {
  return (
    row.status === ReservationStatus.PENDING ||
    row.status === ReservationStatus.CONFIRMED
  );
}

/**
 * Política V1: usa `hoursBeforeArrival` como ventana de cancelación
 * gratuita y `penaltyPct` (porcentaje 0-100 sobre el total). Sin política
 * asociada, 0 (cancelación gratuita).
 */
function computePenalty(
  arrival: Date,
  totalAmount: number,
  policy: { hoursBeforeArrival: number; penaltyPct: Prisma.Decimal } | null,
): number {
  if (!policy) return 0;
  const cutoff = new Date(arrival.getTime() - policy.hoursBeforeArrival * 3600_000);
  if (new Date() < cutoff) return 0;
  const pct = Math.max(0, Math.min(100, Number(policy.penaltyPct))) / 100;
  return Math.max(0, totalAmount * pct);
}
