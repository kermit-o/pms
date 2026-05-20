import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { SiteMinderProvider } from './siteminder.provider';

const FETCH_ORIG = globalThis.fetch;

describe('SiteMinderProvider.verifyWebhookSignature', () => {
  const provider = new SiteMinderProvider();
  const secret = 'shared-secret-1234';
  const body = JSON.stringify({ a: 1 });

  it('returns true with valid signature', () => {
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    expect(provider.verifyWebhookSignature(body, { 'x-siteminder-signature': sig }, secret)).toBe(
      true,
    );
  });

  it('returns false with wrong signature', () => {
    expect(
      provider.verifyWebhookSignature(body, { 'x-siteminder-signature': 'deadbeef' }, secret),
    ).toBe(false);
  });

  it('returns false without header', () => {
    expect(provider.verifyWebhookSignature(body, {}, secret)).toBe(false);
  });
});

describe('SiteMinderProvider.parseInboundReservation', () => {
  const provider = new SiteMinderProvider();

  it('maps booking.com → BOOKING_COM', () => {
    const out = provider.parseInboundReservation(
      JSON.stringify({
        reservationId: 'sm-1',
        channelCode: 'BDC',
        arrival: '2026-07-15',
        departure: '2026-07-17',
        adults: 2,
        children: 1,
        roomTypeCode: 'DBL',
        total: { amount: '200.00', currency: 'EUR' },
        customer: { firstName: 'A', lastName: 'B', email: 'a@b' },
      }),
    );
    expect(out.externalRef).toBe('sm-1');
    expect(out.source).toBe('BOOKING_COM');
    expect(out.totalAmount).toBe('200.00');
    expect(out.guest.firstName).toBe('A');
  });

  it('maps expedia → EXPEDIA', () => {
    const out = provider.parseInboundReservation(
      JSON.stringify({
        reservationId: 'sm-2',
        channelCode: 'expedia',
        arrival: '2026-07-15',
        departure: '2026-07-17',
        roomTypeCode: 'DBL',
      }),
    );
    expect(out.source).toBe('EXPEDIA');
  });

  it('unknown channel → OTHER_OTA', () => {
    const out = provider.parseInboundReservation(
      JSON.stringify({
        reservationId: 'sm-3',
        channelCode: 'random-channel',
        arrival: '2026-07-15',
        departure: '2026-07-17',
        roomTypeCode: 'DBL',
      }),
    );
    expect(out.source).toBe('OTHER_OTA');
  });

  it('throws on invalid payload', () => {
    expect(() => provider.parseInboundReservation('{}')).toThrow(/invalid/);
  });
});

describe('SiteMinderProvider push', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as never;
  });
  afterEach(() => {
    globalThis.fetch = FETCH_ORIG;
  });

  it('pushAvailability returns pushed count on 2xx', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true } as never);
    const provider = new SiteMinderProvider();
    const out = await provider.pushAvailability({
      apiBase: 'https://api.test',
      apiKey: 'k',
      cmPropertyId: 'p',
      items: [
        { roomTypeCode: 'DBL', date: '2026-07-15', available: 5 },
        { roomTypeCode: 'DBL', date: '2026-07-16', available: 4 },
      ],
    });
    expect(out.pushed).toBe(2);
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('https://api.test/properties/p/availability');
    expect((call[1] as RequestInit).method).toBe('PUT');
  });

  it('throws on non-2xx response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => 'bad gateway',
    } as never);
    const provider = new SiteMinderProvider();
    await expect(
      provider.pushAvailability({
        apiBase: 'https://api.test',
        apiKey: 'k',
        cmPropertyId: 'p',
        items: [{ roomTypeCode: 'DBL', date: '2026-07-15', available: 5 }],
      }),
    ).rejects.toThrow(/siteminder_push_availability_502/);
  });

  it('skips fetch when items empty', async () => {
    const provider = new SiteMinderProvider();
    const out = await provider.pushAvailability({
      apiBase: 'https://api.test',
      apiKey: 'k',
      cmPropertyId: 'p',
      items: [],
    });
    expect(out).toEqual({ pushed: 0, skipped: 0 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
