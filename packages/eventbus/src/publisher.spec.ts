import { describe, expect, it, vi } from 'vitest';
import { EventPublisher } from './publisher';

function fakeJs(seq = 1n) {
  return {
    publish: vi.fn().mockResolvedValue({ seq }),
  };
}

describe('EventPublisher', () => {
  const ctx = { tenantId: '11111111-1111-1111-1111-111111111111' };

  it('validates payload with the catalog Zod schema and publishes envelope', async () => {
    const js = fakeJs();
    const pub = new EventPublisher(js as never);

    const result = await pub.publish('property.created', ctx, {
      propertyId: '11111111-1111-1111-1111-111111111002',
      code: 'BCN01',
      name: 'Hotel Demo',
      timezone: 'Europe/Madrid',
      currency: 'EUR',
    });

    expect(result.type).toBe('property.created');
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.sequence).toBe(1);

    expect(js.publish).toHaveBeenCalledOnce();
    const [subject, encoded, opts] = js.publish.mock.calls[0] as unknown as [
      string,
      Uint8Array,
      { headers: { get(k: string): string } },
    ];
    expect(subject).toBe('pms.events.property.created');
    expect(opts.headers.get('Nats-Msg-Id')).toBe(result.id);

    const decoded = JSON.parse(Buffer.from(encoded).toString('utf8'));
    expect(decoded).toMatchObject({
      type: 'property.created',
      schemaVersion: 1,
      tenantId: ctx.tenantId,
      actorId: null,
      correlationId: null,
      payload: {
        propertyId: '11111111-1111-1111-1111-111111111002',
        code: 'BCN01',
        name: 'Hotel Demo',
        timezone: 'Europe/Madrid',
        currency: 'EUR',
      },
    });
  });

  it('rejects invalid payload before publishing', async () => {
    const js = fakeJs();
    const pub = new EventPublisher(js as never);

    await expect(
      pub.publish('property.created', ctx, {
        propertyId: 'not-a-uuid',
        code: '',
        name: 'x',
        timezone: 'Europe/Madrid',
        currency: 'EU', // wrong length
      } as never),
    ).rejects.toThrow();

    expect(js.publish).not.toHaveBeenCalled();
  });

  it('rejects unknown event type', async () => {
    const js = fakeJs();
    const pub = new EventPublisher(js as never);
    await expect(pub.publish('not.a.real.event' as never, ctx, {} as never)).rejects.toThrow(
      /Unknown event type/,
    );
  });

  it('propagates actorId and correlationId', async () => {
    const js = fakeJs();
    const pub = new EventPublisher(js as never);

    await pub.publish(
      'property.updated',
      { ...ctx, actorId: 'user-1', correlationId: 'corr-x' },
      { propertyId: '11111111-1111-1111-1111-111111111002', changes: { name: 'New' } },
    );

    const [, encoded] = js.publish.mock.calls[0] as unknown as [string, Uint8Array, unknown];
    const decoded = JSON.parse(Buffer.from(encoded).toString('utf8'));
    expect(decoded.actorId).toBe('user-1');
    expect(decoded.correlationId).toBe('corr-x');
  });
});
