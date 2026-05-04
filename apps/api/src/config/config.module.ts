import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';

function resolveEnvFiles(): string[] {
  const candidates = [
    resolve(process.cwd(), '.env'),                  // apps/api/.env (override local opcional)
    resolve(process.cwd(), '../../.env.local'),      // raiz del monorepo (override personal)
    resolve(process.cwd(), '../../.env'),            // raiz del monorepo (default)
  ];
  return candidates.filter((p) => existsSync(p));
}

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: resolveEnvFiles(),
      validate: (raw) => validateEnv(raw),
    }),
  ],
})
export class ConfigModule {}
