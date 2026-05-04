import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema';

const validBase = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/pms',
  REDIS_URL: 'redis://localhost:6379',
  NATS_URL: 'nats://localhost:4222',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'pms',
  KEYCLOAK_CLIENT_ID: 'pms-api',
};

describe('validateEnv', () => {
  it('parses a valid environment with defaults', () => {
    const env = validateEnv(validBase);
    expect(env.NODE_ENV).toBe('test');
    expect(env.APP_PORT).toBe(3000);
    expect(env.APP_HOST).toBe('0.0.0.0');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('coerces APP_PORT from string', () => {
    const env = validateEnv({ ...validBase, APP_PORT: '4000' });
    expect(env.APP_PORT).toBe(4000);
  });

  it('throws on missing required vars', () => {
    expect(() => validateEnv({})).toThrow(/Invalid environment variables/);
  });

  it('throws on invalid URL', () => {
    expect(() => validateEnv({ ...validBase, DATABASE_URL: 'not-a-url' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
