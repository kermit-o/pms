import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db';

const baseEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/pms',
  DIRECT_URL: 'postgresql://user:pass@localhost:5432/pms',
  REDIS_URL: 'redis://localhost:6379',
  NATS_URL: 'nats://localhost:4222',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'pms',
  KEYCLOAK_CLIENT_ID: 'pms-api',
};

class FakePrismaService {
  pingResult: 'ok' | 'fail' = 'ok';
  async onModuleInit() {}
  async onModuleDestroy() {}
  async ping() {
    if (this.pingResult === 'fail') {
      throw new Error('simulated ping failure');
    }
  }
}

describe('Health (e2e)', () => {
  let app: NestFastifyApplication;
  let fakePrisma: FakePrismaService;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    Object.assign(process.env, baseEnv);

    fakePrisma = new FakePrismaService();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .compile();

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

  it('GET /readyz returns 200 when DB ping succeeds', async () => {
    fakePrisma.pingResult = 'ok';
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; checks: { db: string } };
    expect(body.status).toBe('ok');
    expect(body.checks.db).toBe('ok');
  });

  it('GET /readyz returns 503 when DB ping fails', async () => {
    fakePrisma.pingResult = 'fail';
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
  });

  it('echoes incoming x-correlation-id header', async () => {
    fakePrisma.pingResult = 'ok';
    const id = '11111111-1111-1111-1111-111111111111';
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-correlation-id': id },
    });
    expect(res.headers['x-correlation-id']).toBe(id);
  });
});
