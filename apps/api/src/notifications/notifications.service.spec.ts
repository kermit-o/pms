import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NotificationsService } from './notifications.service';
import { renderTemplate } from './templates';

const FETCH_ORIG = globalThis.fetch;

function buildConfig(env: Record<string, string | undefined>) {
  return {
    get: vi.fn((key: string) => env[key]),
  };
}

describe('NotificationsService', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as never;
  });
  afterEach(() => {
    globalThis.fetch = FETCH_ORIG;
  });

  it('falls back to dry_run when POSTMARK_SERVER_TOKEN is missing', async () => {
    const service = new NotificationsService(buildConfig({}) as never);
    expect(service.mode).toBe('dry_run');
    const out = await service.sendEmail({
      template: 'reservation_confirmation',
      to: 'a@b.test',
      locale: 'es',
      params: { code: 'X', hotelName: 'H', guestFirstName: 'A', arrival: '1', departure: '2', roomTypeName: 'DBL', totalAmount: '1', currency: 'EUR', manageUrl: '' },
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.messageId).toMatch(/^dryrun-/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('uses Postmark when token + from configured', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ MessageID: 'pm-1' }),
    } as never);
    const service = new NotificationsService(
      buildConfig({
        POSTMARK_SERVER_TOKEN: 'tk',
        NOTIFICATIONS_FROM: 'no-reply@aubergine.test',
      }) as never,
    );
    expect(service.mode).toBe('live');
    const out = await service.sendEmail({
      template: 'reservation_cancelled',
      to: 'guest@test',
      locale: 'es',
      params: { code: 'X', hotelName: 'H', guestFirstName: 'A', penalty: '0', currency: 'EUR' },
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.messageId).toBe('pm-1');
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('https://api.postmarkapp.com/email');
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.From).toBe('no-reply@aubergine.test');
    expect(body.To).toBe('guest@test');
    expect(body.Subject).toContain('cancelada');
  });

  it('handles Postmark error gracefully', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ Message: 'Bad From' }),
    } as never);
    const service = new NotificationsService(
      buildConfig({
        POSTMARK_SERVER_TOKEN: 'tk',
        NOTIFICATIONS_FROM: 'no-reply@aubergine.test',
      }) as never,
    );
    const out = await service.sendEmail({
      template: 'reservation_confirmation',
      to: 'g@t',
      locale: 'en',
      params: { code: 'X', hotelName: 'H', guestFirstName: 'A', arrival: '1', departure: '2', roomTypeName: 'DBL', totalAmount: '1', currency: 'EUR', manageUrl: '' },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('Bad From');
  });
});

describe('renderTemplate', () => {
  it('interpolates {{ key }} including nested keys', () => {
    const r = renderTemplate('reservation_confirmation', 'es', {
      code: 'X-1',
      hotelName: 'Hotel A',
      guestFirstName: 'María',
      arrival: '2026-07-15',
      departure: '2026-07-17',
      roomTypeName: 'Doble',
      totalAmount: '200.00',
      currency: 'EUR',
      manageUrl: 'https://x',
      brand: { name: 'Hotel A' },
    });
    expect(r.subject).toBe('✓ Reserva confirmada X-1 — Hotel A');
    expect(r.html).toContain('María');
    expect(r.html).toContain('200.00 EUR');
    expect(r.text).toContain('X-1');
  });

  it('falls back to ES when locale missing', () => {
    const r = renderTemplate('front_desk_new_reservation', 'en', {
      code: 'Y',
      guestFirstName: 'A',
      guestLastName: 'B',
      source: 'IBE',
      arrival: '1',
      departure: '2',
      roomTypeName: 'DBL',
      totalAmount: '1',
      currency: 'EUR',
      backofficeUrl: 'u',
    });
    expect(r.subject).toContain('Nueva reserva'); // ES fallback (no EN defined yet)
  });
});
