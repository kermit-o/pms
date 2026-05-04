import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';

const baseEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/pms',
  REDIS_URL: 'redis://localhost:6379',
  NATS_URL: 'nats://localhost:4222',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'pms',
  KEYCLOAK_CLIENT_ID: 'pms-api',
};

describe('Health (e2e)', () => {
  let app: NestFastifyApplication;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    Object.assign(process.env, baseEnv);

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    process.env = originalEnv;
  });

  it('GET /healthz returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; timestamp: string };
    expect(body.status).toBe('ok');
  });

  it('GET /readyz returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
  });

  it('echoes incoming x-correlation-id header', async () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-correlation-id': id },
    });
    expect(res.headers['x-correlation-id']).toBe(id);
  });
});
