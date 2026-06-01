import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { VerifactuModule } from './verifactu.module';

function makeModule(env: Partial<Env>): VerifactuModule {
  const config = {
    get: (key: keyof Env) => env[key],
  } as unknown as ConfigService<Env, true>;
  return new VerifactuModule(config);
}

describe('VerifactuModule.onModuleInit (guards)', () => {
  it('boots in stub + development without master key', () => {
    const m = makeModule({ VERIFACTU_MODE: 'stub', NODE_ENV: 'development' });
    expect(() => m.onModuleInit()).not.toThrow();
  });

  it('refuses NODE_ENV=production with non-production mode', () => {
    const m = makeModule({
      VERIFACTU_MODE: 'preprod',
      NODE_ENV: 'production',
      VERIFACTU_MASTER_KEY: 'x'.repeat(40),
    });
    expect(() => m.onModuleInit()).toThrow(/VERIFACTU_MODE=production/);
  });

  it('refuses VERIFACTU_MODE=production with non-production NODE_ENV', () => {
    const m = makeModule({
      VERIFACTU_MODE: 'production',
      NODE_ENV: 'development',
      VERIFACTU_MASTER_KEY: 'x'.repeat(40),
    });
    expect(() => m.onModuleInit()).toThrow(/requiere NODE_ENV=production/);
  });

  it('refuses non-stub mode without VERIFACTU_MASTER_KEY', () => {
    const m = makeModule({
      VERIFACTU_MODE: 'preprod',
      NODE_ENV: 'development',
    });
    expect(() => m.onModuleInit()).toThrow(/VERIFACTU_MASTER_KEY/);
  });

  it('refuses non-stub mode without VERIFACTU_AEAT_ENDPOINT', () => {
    const m = makeModule({
      VERIFACTU_MODE: 'preprod',
      NODE_ENV: 'development',
      VERIFACTU_MASTER_KEY: 'x'.repeat(40),
    });
    expect(() => m.onModuleInit()).toThrow(/VERIFACTU_AEAT_ENDPOINT/);
  });

  it('permite stub en production cuando VERIFACTU_ALLOW_STUB_IN_PROD=true (escape-hatch piloto)', () => {
    const m = makeModule({
      VERIFACTU_MODE: 'stub',
      NODE_ENV: 'production',
      VERIFACTU_ALLOW_STUB_IN_PROD: true,
    });
    expect(() => m.onModuleInit()).not.toThrow();
  });

  it('sigue rechazando stub en production si VERIFACTU_ALLOW_STUB_IN_PROD=false', () => {
    const m = makeModule({
      VERIFACTU_MODE: 'stub',
      NODE_ENV: 'production',
      VERIFACTU_ALLOW_STUB_IN_PROD: false,
    });
    expect(() => m.onModuleInit()).toThrow(/VERIFACTU_ALLOW_STUB_IN_PROD=true/);
  });

  it('boots in production + production mode with master key + endpoint', () => {
    const m = makeModule({
      VERIFACTU_MODE: 'production',
      NODE_ENV: 'production',
      VERIFACTU_MASTER_KEY: 'x'.repeat(40),
      VERIFACTU_AEAT_ENDPOINT: 'https://aeat.example.test/verifactu',
    });
    expect(() => m.onModuleInit()).not.toThrow();
  });
});
