import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// SWC en lugar de esbuild: emite design:paramtypes correctamente, lo cual
// es imprescindible para que la inyeccion de dependencias por tipo de
// parametro funcione (NestJS guards, services, etc.) tanto en unit como
// en e2e tests.
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/*.module.ts', 'src/**/*.spec.ts'],
    },
  },
});
