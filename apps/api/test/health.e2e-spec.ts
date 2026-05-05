import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { JwtValidatorService } from '../src/auth';
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
    if (this.pingResult === 'fail') throw new Error('simulated ping failure');
  }
}

class FakeJwtValidatorService {
  // Token format: 'fake:<sub>:<tenantId>:<roles-csv>'
  onModuleInit() {}
  async verify(token: string) {
    if (!token.startsWith('fake:')) throw new Error('invalid');
    const [, sub, tenantId, rolesCsv] = token.split(':');
    return {
      sub,
      email: `${sub}@demo.local`,
      tenantId,
      roles: (rolesCsv ?? '').split(',').filter(Boolean),
    };
  }
}

describe('Health + Auth (e2e)', () => {
  let app: NestFastifyApplication;
  let fakePrisma: FakePrismaService;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    Object.assign(process.env, baseEnv);

    fakePrisma = new FakePrismaService();
    const fakeJwt = new FakeJwtValidatorService();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .overrideProvider(JwtValidatorService)
      .useValue(fakeJwt)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    process.env = originalEnv;
  });

  describe('Public routes', () => {
    it('GET /healthz works without token', async () => {
      const res = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ok' });
    });

    it('GET /readyz works without token', async () => {
      fakePrisma.pingResult = 'ok';
      const res = await app.inject({ method: 'GET', url: '/readyz' });
      expect(res.statusCode).toBe(200);
    });

    it('GET /readyz returns 503 when DB ping fails', async () => {
      fakePrisma.pingResult = 'fail';
      const res = await app.inject({ method: 'GET', url: '/readyz' });
      expect(res.statusCode).toBe(503);
    });

    it('echoes incoming x-correlation-id header on /healthz', async () => {
      const id = '11111111-1111-1111-1111-111111111111';
      const res = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { 'x-correlation-id': id },
      });
      expect(res.headers['x-correlation-id']).toBe(id);
    });
  });

  describe('Protected routes', () => {
    it('GET /me without token returns 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/me' });
      expect(res.statusCode).toBe(401);
    });

    it('GET /me with valid token returns user claims', async () => {
      const token = 'fake:user-1:tenant-a:front_desk,tenant_admin';
      const res = await app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        sub: 'user-1',
        email: 'user-1@demo.local',
        tenantId: 'tenant-a',
        roles: ['front_desk', 'tenant_admin'],
      });
    });

    it('GET /properties without token returns 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/properties' });
      expect(res.statusCode).toBe(401);
    });

    it('GET /properties with token but missing role returns 403', async () => {
      const token = 'fake:user-1:tenant-a:housekeeper';
      const res = await app.inject({
        method: 'GET',
        url: '/properties',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
