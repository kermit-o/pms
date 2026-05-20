import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { EmailSuppressionReason } from '@pms/db';
import { PostmarkWebhookController } from './postmark-webhook.controller';
import type { EmailSuppressionsService } from './email-suppressions.service';

const SECRET = 'wh-secret-1234';

function buildController() {
  const suppressions = {
    isSuppressed: vi.fn(),
    upsert: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(true),
  } as unknown as EmailSuppressionsService;
  const config = {
    get: vi.fn((key: string) => (key === 'POSTMARK_WEBHOOK_SECRET' ? SECRET : undefined)),
  };
  const controller = new PostmarkWebhookController(config as never, suppressions);
  return { controller, suppressions };
}

function signedRaw(body: object) {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', SECRET).update(raw).digest('hex');
  return { raw, sig };
}

function reqFor(raw: string) {
  return { body: raw } as never;
}

describe('PostmarkWebhookController', () => {
  it('returns 503 when secret is missing', async () => {
    const suppressions = {} as unknown as EmailSuppressionsService;
    const config = { get: vi.fn(() => undefined) };
    const controller = new PostmarkWebhookController(config as never, suppressions);
    await expect(
      controller.handle(reqFor('{}'), 'whatever', {} as never),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects bad signature with 403', async () => {
    const { controller } = buildController();
    const body = { RecordType: 'Bounce', Type: 'HardBounce', Email: 'a@b.test' };
    await expect(
      controller.handle(reqFor(JSON.stringify(body)), 'deadbeef', body as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('hard bounce → suppression added', async () => {
    const { controller, suppressions } = buildController();
    const body = {
      RecordType: 'Bounce',
      Type: 'HardBounce',
      Email: 'a@b.test',
      Description: 'inbox does not exist',
    };
    const { raw, sig } = signedRaw(body);
    const out = await controller.handle(reqFor(raw), sig, body as never);
    expect(out).toMatchObject({ action: 'suppressed', reason: 'hard_bounce' });
    expect(suppressions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@b.test',
        reason: EmailSuppressionReason.HARD_BOUNCE,
        source: 'postmark',
      }),
    );
  });

  it('soft bounce → no suppression', async () => {
    const { controller, suppressions } = buildController();
    const body = {
      RecordType: 'Bounce',
      Type: 'Transient',
      Email: 'a@b.test',
    };
    const { raw, sig } = signedRaw(body);
    const out = await controller.handle(reqFor(raw), sig, body as never);
    expect(out).toMatchObject({ action: 'noop', reason: 'soft_bounce' });
    expect(suppressions.upsert).not.toHaveBeenCalled();
  });

  it('spam complaint → suppression added', async () => {
    const { controller, suppressions } = buildController();
    const body = { RecordType: 'SpamComplaint', Email: 'a@b.test' };
    const { raw, sig } = signedRaw(body);
    const out = await controller.handle(reqFor(raw), sig, body as never);
    expect(out).toMatchObject({ action: 'suppressed', reason: 'spam_complaint' });
    expect(suppressions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: EmailSuppressionReason.SPAM_COMPLAINT }),
    );
  });

  it('subscription change (suppress) → suppression added', async () => {
    const { controller, suppressions } = buildController();
    const body = {
      RecordType: 'SubscriptionChange',
      Email: 'a@b.test',
      SuppressSending: true,
    };
    const { raw, sig } = signedRaw(body);
    const out = await controller.handle(reqFor(raw), sig, body as never);
    expect(out).toMatchObject({ action: 'suppressed', reason: 'unsubscribe' });
    expect(suppressions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: EmailSuppressionReason.UNSUBSCRIBE }),
    );
  });

  it('subscription change (resubscribe) → removes suppression', async () => {
    const { controller, suppressions } = buildController();
    const body = {
      RecordType: 'SubscriptionChange',
      Email: 'a@b.test',
      SuppressSending: false,
    };
    const { raw, sig } = signedRaw(body);
    const out = await controller.handle(reqFor(raw), sig, body as never);
    expect(out).toMatchObject({ action: 'reactivated' });
    expect(suppressions.remove).toHaveBeenCalledWith('a@b.test');
  });

  it('unknown record type → 200 + noop', async () => {
    const { controller, suppressions } = buildController();
    const body = { RecordType: 'Open', Email: 'a@b.test', MessageID: 'm-1' };
    const { raw, sig } = signedRaw(body);
    const out = await controller.handle(reqFor(raw), sig, body as never);
    expect(out).toMatchObject({ action: 'noop', reason: 'record_type_ignored' });
    expect(suppressions.upsert).not.toHaveBeenCalled();
  });

  it('payload without email → 200 + ignored', async () => {
    const { controller, suppressions } = buildController();
    const body = { RecordType: 'Bounce', Type: 'HardBounce' };
    const { raw, sig } = signedRaw(body);
    const out = await controller.handle(reqFor(raw), sig, body as never);
    expect(out).toMatchObject({ action: 'ignored', reason: 'no_email' });
    expect(suppressions.upsert).not.toHaveBeenCalled();
  });
});
