// Debe ser el PRIMER import — las auto-instrumentations de OTel parchean
// http/fastify/prisma/nats/pino en el momento en que se cargan.
import './observability/tracing';

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableShutdownHooks();

  const config = app.get(ConfigService<Env, true>);
  // Prioridad: PORT (inyectado dinamicamente por Railway/Fly/Heroku/Cloud Run)
  // > APP_PORT del .env / Zod default (3000 en dev local).
  const port = Number(process.env.PORT) || config.get('APP_PORT', { infer: true });
  const host = config.get('APP_HOST', { infer: true });

  await app.listen(port, host);
  app.get(Logger).log(`PMS API listening on http://${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
