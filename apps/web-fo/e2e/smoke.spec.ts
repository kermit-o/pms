import { expect, test } from '@playwright/test';

/**
 * Smoke tests that don't need a real Keycloak — they verify routing and
 * middleware contracts that we don't want to regress.
 */
test.describe('routing and middleware', () => {
  test('/login renders the Aubergine wordmark and Keycloak CTA', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Aubergine')).toBeVisible();
    await expect(page.getByRole('button', { name: /Continuar con Keycloak/i })).toBeVisible();
  });

  test('unauthenticated /dashboard redirects to /login with callbackUrl', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fdashboard$/);
  });

  test('unauthenticated /reservations redirects to /login', async ({ page }) => {
    await page.goto('/reservations');
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Freservations$/);
  });

  test('unauthenticated /compliance/ses redirects to /login', async ({ page }) => {
    await page.goto('/compliance/ses');
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fcompliance%2Fses$/);
  });

  test('root redirects to /login when no session', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login(\?|$)/);
  });
});
