import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller';
import type { PrismaService } from '../db';
import type { EventbusService } from '../eventbus';

function makeController(opts: {
  ping: () => Promise<void>;
  natsPing?: () => void;
}): HealthController {
  return new HealthController(
    { ping: opts.ping } as unknown as PrismaService,
    { ping: opts.natsPing ?? (() => undefined) } as unknown as EventbusService,
  );
}

describe('HealthController', () => {
  it('liveness returns ok', () => {
    const result = makeController({ ping: async () => undefined }).liveness();
    expect(result.status).toBe('ok');
    expect(typeof result.timestamp).toBe('string');
  });

  it('readiness returns ok when DB and NATS checks succeed', async () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    const natsPing = vi.fn();
    const result = await makeController({ ping, natsPing }).readiness();
    expect(result.status).toBe('ok');
    expect(result.checks.db).toBe('ok');
    expect(result.checks.nats).toBe('ok');
    expect(ping).toHaveBeenCalledOnce();
    expect(natsPing).toHaveBeenCalledOnce();
  });

  it('readiness throws 503 when DB ping fails', async () => {
    const ping = vi.fn().mockRejectedValue(new Error('connection refused'));
    await expect(makeController({ ping }).readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('readiness throws 503 when NATS ping fails', async () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    const natsPing = vi.fn(() => {
      throw new Error('nats closed');
    });
    await expect(makeController({ ping, natsPing }).readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
