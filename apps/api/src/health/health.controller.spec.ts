import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller';
import type { PrismaService } from '../db';

function makeController(ping: () => Promise<void>): HealthController {
  return new HealthController({ ping } as unknown as PrismaService);
}

describe('HealthController', () => {
  it('liveness returns ok', () => {
    const result = makeController(async () => undefined).liveness();
    expect(result.status).toBe('ok');
    expect(typeof result.timestamp).toBe('string');
  });

  it('readiness returns ok when DB ping succeeds', async () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    const result = await makeController(ping).readiness();
    expect(result.status).toBe('ok');
    expect(result.checks.db).toBe('ok');
    expect(ping).toHaveBeenCalledOnce();
  });

  it('readiness throws 503 when DB ping fails', async () => {
    const ping = vi.fn().mockRejectedValue(new Error('connection refused'));
    await expect(makeController(ping).readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
