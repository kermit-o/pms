import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('liveness returns ok', () => {
    const result = controller.liveness();
    expect(result.status).toBe('ok');
    expect(typeof result.timestamp).toBe('string');
  });

  it('readiness returns ok', () => {
    const result = controller.readiness();
    expect(result.status).toBe('ok');
    expect(typeof result.timestamp).toBe('string');
  });
});
