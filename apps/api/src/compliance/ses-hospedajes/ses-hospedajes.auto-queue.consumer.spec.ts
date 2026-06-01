import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.schema';
import type { EventbusService } from '../../eventbus';
import { SesHospedajesAutoQueueConsumer } from './ses-hospedajes.auto-queue.consumer';
import type { SesHospedajesService } from './ses-hospedajes.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PROPERTY_ID = '22222222-2222-2222-2222-222222222222';

function makeConsumer(serviceImpl: Partial<SesHospedajesService>) {
  const bus = { subscribe: vi.fn(), publish: vi.fn() } as unknown as EventbusService;
  const ses = serviceImpl as SesHospedajesService;
  const config = {
    get: (key: keyof Env) => (key === 'NODE_ENV' ? 'test' : undefined),
  } as unknown as ConfigService<Env, true>;
  return new SesHospedajesAutoQueueConsumer(bus, ses, config);
}

const BASE_ARGS = {
  tenantId: TENANT_ID,
  actorId: null,
  correlationId: 'corr-1',
  payload: { propertyId: PROPERTY_ID, businessDate: '2026-05-30' },
};

describe('SesHospedajesAutoQueueConsumer.handle', () => {
  it('acks after delegating to ses.queue() in the happy path', async () => {
    const queue = vi.fn().mockResolvedValue({
      submissionId: 'sub-1',
      xmlPayload: '<xml/>',
      guestCount: 3,
    });
    const consumer = makeConsumer({ queue });
    const r = await consumer.handle(BASE_ARGS);
    expect(r).toBe('ack');
    expect(queue).toHaveBeenCalledTimes(1);
    const [user, corr, input] = queue.mock.calls[0]!;
    expect(user.tenantId).toBe(TENANT_ID);
    expect(user.sub).toBe('system:ses-auto');
    expect(user.roles).toContain('tenant_admin');
    expect(corr).toBe('corr-1');
    expect(input).toEqual({ propertyId: PROPERTY_ID, businessDate: '2026-05-30' });
  });

  it('acks idempotent when the submission is already SENT (Conflict)', async () => {
    const queue = vi.fn().mockRejectedValue(new ConflictException('already sent'));
    const consumer = makeConsumer({ queue });
    await expect(consumer.handle(BASE_ARGS)).resolves.toBe('ack');
  });

  it('terms when the property no longer exists (NotFound)', async () => {
    const queue = vi.fn().mockRejectedValue(new NotFoundException('property not found'));
    const consumer = makeConsumer({ queue });
    await expect(consumer.handle(BASE_ARGS)).resolves.toBe('term');
  });

  it('naks on transient errors so JetStream retries', async () => {
    const queue = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const consumer = makeConsumer({ queue });
    await expect(consumer.handle(BASE_ARGS)).resolves.toBe('nak');
  });

  it('does not subscribe when NODE_ENV=test', async () => {
    const subscribe = vi.fn();
    const bus = { subscribe, publish: vi.fn() } as unknown as EventbusService;
    const ses = { queue: vi.fn() } as unknown as SesHospedajesService;
    const config = {
      get: (key: keyof Env) => (key === 'NODE_ENV' ? 'test' : undefined),
    } as unknown as ConfigService<Env, true>;
    const consumer = new SesHospedajesAutoQueueConsumer(bus, ses, config);
    await consumer.onModuleInit();
    expect(subscribe).not.toHaveBeenCalled();
  });
});
