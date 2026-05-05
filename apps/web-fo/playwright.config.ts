import { defineConfig, devices } from '@playwright/test';

/**
 * Aubergine FO end-to-end tests.
 *
 * Smoke tests run without a real Keycloak: they hit the unauth-only routes
 * (/login, /api/auth/*) and verify routing/middleware behaviour. Full happy-
 * path flows that require an authenticated session are gated on the
 * E2E_KEYCLOAK_USER env vars and skipped otherwise.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_NO_WEBSERVER
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3001/login',
        timeout: 60_000,
        reuseExistingServer: !process.env.CI,
        env: {
          KEYCLOAK_ISSUER:
            process.env.KEYCLOAK_ISSUER ??
            'http://localhost:8080/realms/pms',
          AUTH_SECRET:
            process.env.AUTH_SECRET ?? 'e2e-only-secret-32chars-padding',
          AUTH_TRUST_HOST: 'true',
          NEXT_PUBLIC_API_URL:
            process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
        },
      },
});
