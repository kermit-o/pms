import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
  esbuild: {
    target: 'es2022',
    sourcemap: true,
  },
});
