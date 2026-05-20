import { describe, expect, it, vi } from 'vitest';
import { NotificationOutboxStatus } from '@pms/db';
import { NotificationsConsumer } from './notifications.consumer';
import type { EmailSuppressionsService } from './email-suppressions.service';
import type { NotificationsService } from './notifications.service';
import type { EventbusService } from '../eventbus';

function buildConsumer(opts: {
  existing?: { status: NotificationOutboxStatus; attempts?: number; id?: string } | null;
  suppressed?: { suppressed: true; reason: string };
  send?: { ok: true; messageId: string } | { ok: false; error: string };
} = {}) {
  const outbox = {
    findUnique: vi.fn().mockResolvedValue(opts.existing ?? null),
    upsert: vi.fn().mockResolvedValue({ id: 'outbox-1', attempts: 1 }),
    update: vi.fn().mockResolvedValue({}),
  };
  const prisma = { notificationOutbox: outbox } as never;
  const bus = { subscribe: vi.fn(), isHealthy: () => true } as unknown as EventbusService;
  const notifications = {
    sendEmail: vi
      .fn()
      .mockResolvedValue(opts.send ?? { ok: true, messageId: 'pm-1' }),
  } as unknown as NotificationsService;
  const suppressions = {
    isSuppressed: vi.fn().mockResolvedValue(opts.suppressed ?? { suppressed: false }),
  } as unknown as EmailSuppressionsService;
  const config = { get: vi.fn(() => 'test') };
  const consumer = new NotificationsConsumer(
    prisma,
    bus,
    notifications,
    suppressions,
    config as never,
  );
  return { consumer, outbox, notifications, suppressions };
}

const payload = {
  template: 'reservation_confirmation' as const,
  to: 'guest@hotel.test',
  locale: 'es' as const,
  params: { code: 'BBM-1' },
  dedupKey: 'ibe-confirmation-BBM-1',
};

describe('NotificationsConsumer.handle', () => {
  it('idempotent ack when outbox is DELIVERED', async () => {
    const { consumer, outbox, notifications } = buildConsumer({
      existing: { status: NotificationOutboxStatus.DELIVERED, id: 'o-1' },
    });
    const out = await consumer.handle(payload, 'env-1');
    expect(out).toBe('ack');
    expect(outbox.upsert).not.toHaveBeenCalled();
    expect(notifications.sendEmail).not.toHaveBeenCalled();
  });

  it('idempotent ack when outbox is SUPPRESSED', async () => {
    const { consumer, notifications } = buildConsumer({
      existing: { status: NotificationOutboxStatus.SUPPRESSED, id: 'o-1' },
    });
    const out = await consumer.handle(payload, 'env-1');
    expect(out).toBe('ack');
    expect(notifications.sendEmail).not.toHaveBeenCalled();
  });

  it('happy path: PENDING → DELIVERED, ack', async () => {
    const { consumer, outbox, notifications } = buildConsumer();
    const out = await consumer.handle(payload, 'env-1');
    expect(out).toBe('ack');
    expect(outbox.upsert).toHaveBeenCalledOnce();
    expect(notifications.sendEmail).toHaveBeenCalledOnce();
    const lastUpdate = outbox.update.mock.calls.at(-1)![0]!;
    expect(lastUpdate.data.status).toBe(NotificationOutboxStatus.DELIVERED);
    expect(lastUpdate.data.messageId).toBe('pm-1');
  });

  it('suppressed: term (no retry) + status=SUPPRESSED', async () => {
    const { consumer, outbox } = buildConsumer({
      suppressed: { suppressed: true, reason: 'HARD_BOUNCE' },
    });
    const out = await consumer.handle(payload, 'env-1');
    expect(out).toBe('term');
    const lastUpdate = outbox.update.mock.calls.at(-1)![0]!;
    expect(lastUpdate.data.status).toBe(NotificationOutboxStatus.SUPPRESSED);
    expect(lastUpdate.data.lastError).toContain('HARD_BOUNCE');
  });

  it('transient error: nak (retry) + status=FAILED', async () => {
    const { consumer, outbox } = buildConsumer({
      send: { ok: false, error: 'connection_timeout' },
    });
    const out = await consumer.handle(payload, 'env-1');
    expect(out).toBe('nak');
    const lastUpdate = outbox.update.mock.calls.at(-1)![0]!;
    expect(lastUpdate.data.status).toBe(NotificationOutboxStatus.FAILED);
    expect(lastUpdate.data.lastError).toBe('connection_timeout');
  });

  it('suppressed-from-sendEmail-response: term', async () => {
    const { consumer, outbox } = buildConsumer({
      send: { ok: false, error: 'suppressed:HARD_BOUNCE' },
    });
    const out = await consumer.handle(payload, 'env-1');
    expect(out).toBe('term');
    const lastUpdate = outbox.update.mock.calls.at(-1)![0]!;
    expect(lastUpdate.data.status).toBe(NotificationOutboxStatus.SUPPRESSED);
  });

  it('handler exception: nak + lastError captured', async () => {
    const { consumer, notifications, outbox } = buildConsumer();
    (notifications.sendEmail as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom'),
    );
    const out = await consumer.handle(payload, 'env-1');
    expect(out).toBe('nak');
    const lastUpdate = outbox.update.mock.calls.at(-1)![0]!;
    expect(lastUpdate.data.status).toBe(NotificationOutboxStatus.FAILED);
    expect(lastUpdate.data.lastError).toBe('boom');
  });

  it('uses envelopeId as dedupKey when payload.dedupKey is missing', async () => {
    const { consumer, outbox } = buildConsumer();
    const noDedup = { ...payload, dedupKey: undefined };
    await consumer.handle(noDedup, 'env-xyz');
    expect(outbox.upsert.mock.calls[0]![0]!.where).toEqual({ dedupKey: 'env-xyz' });
  });
});
