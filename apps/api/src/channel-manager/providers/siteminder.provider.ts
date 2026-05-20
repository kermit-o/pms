import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type {
  ChannelManagerProvider,
  InboundReservationParsed,
  PushAvailabilityItem,
  PushRateItem,
} from '../types';

/**
 * SiteMinder REST provider (Sprint 9 W2).
 *
 * Implementación skeleton — sin SDK npm, fetch directo. Los endpoints
 * exactos del SiteMinder Hotel API se confirman en el alta del hotel
 * cliente (cada cuenta de SiteMinder configura su base URL). Por defecto
 * usamos `https://api.siteminder.com/v1` que es la documentación pública
 * del Hotel API REST.
 *
 * El payload de webhook entrante de SiteMinder lleva firma HMAC en el
 * header `x-siteminder-signature` (hex sha256 sobre el cuerpo crudo con
 * el shared secret).
 */
@Injectable()
export class SiteMinderProvider implements ChannelManagerProvider {
  private readonly log = new Logger(SiteMinderProvider.name);
  readonly id = 'siteminder';

  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | undefined>,
    secret: string,
  ): boolean {
    const provided = headers['x-siteminder-signature'];
    if (!provided || typeof provided !== 'string') return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  parseInboundReservation(rawBody: string): InboundReservationParsed {
    const body = JSON.parse(rawBody) as SiteMinderBookingV1;
    if (!body.reservationId || !body.arrival || !body.departure) {
      throw new Error('siteminder_payload_invalid');
    }
    return {
      externalRef: body.reservationId,
      source: mapChannelToSource(body.channelCode),
      arrival: body.arrival,
      departure: body.departure,
      adults: body.adults ?? 1,
      children: body.children ?? 0,
      roomTypeCode: body.roomTypeCode,
      totalAmount: body.total?.amount ?? '0',
      currency: body.total?.currency ?? 'EUR',
      guest: {
        firstName: body.customer?.firstName ?? '',
        lastName: body.customer?.lastName ?? '',
        email: body.customer?.email ?? null,
        phone: body.customer?.phone ?? null,
        nationality: body.customer?.nationality ?? null,
      },
      specialRequests: body.specialRequests ?? null,
    };
  }

  async pushAvailability(input: {
    apiBase: string;
    apiKey: string;
    cmPropertyId: string;
    items: PushAvailabilityItem[];
  }): Promise<{ pushed: number; skipped: number }> {
    if (input.items.length === 0) return { pushed: 0, skipped: 0 };
    const res = await fetch(`${input.apiBase.replace(/\/$/, '')}/properties/${input.cmPropertyId}/availability`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        availability: input.items.map((i) => ({
          roomTypeCode: i.roomTypeCode,
          date: i.date,
          available: i.available,
        })),
      }),
    });
    if (!res.ok) {
      const text = await safeText(res);
      this.log.warn(`SiteMinder availability push HTTP ${res.status}: ${text}`);
      throw new Error(`siteminder_push_availability_${res.status}`);
    }
    return { pushed: input.items.length, skipped: 0 };
  }

  async pushRates(input: {
    apiBase: string;
    apiKey: string;
    cmPropertyId: string;
    items: PushRateItem[];
  }): Promise<{ pushed: number; skipped: number }> {
    if (input.items.length === 0) return { pushed: 0, skipped: 0 };
    const res = await fetch(`${input.apiBase.replace(/\/$/, '')}/properties/${input.cmPropertyId}/rates`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        rates: input.items.map((i) => ({
          roomTypeCode: i.roomTypeCode,
          ratePlanCode: i.ratePlanCode,
          date: i.date,
          amount: i.amount,
          currency: i.currency,
        })),
      }),
    });
    if (!res.ok) {
      const text = await safeText(res);
      this.log.warn(`SiteMinder rates push HTTP ${res.status}: ${text}`);
      throw new Error(`siteminder_push_rates_${res.status}`);
    }
    return { pushed: input.items.length, skipped: 0 };
  }
}

interface SiteMinderBookingV1 {
  reservationId: string;
  channelCode?: string;
  arrival: string;
  departure: string;
  adults?: number;
  children?: number;
  roomTypeCode: string;
  total?: { amount: string; currency: string };
  customer?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    nationality?: string;
  };
  specialRequests?: string;
}

function mapChannelToSource(channelCode: string | undefined): InboundReservationParsed['source'] {
  switch ((channelCode ?? '').toLowerCase()) {
    case 'booking':
    case 'booking.com':
    case 'bdc':
      return 'BOOKING_COM';
    case 'expedia':
    case 'expedia.com':
    case 'exp':
      return 'EXPEDIA';
    default:
      return 'OTHER_OTA';
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable>';
  }
}
