import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.integration.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Tests de integracion necesitan Postgres real (docker compose).
    // Se ejecutan en serie para evitar interferencias entre datasets.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
  esbuild: {
    target: 'es2022',
    sourcemap: true,
  },
});
