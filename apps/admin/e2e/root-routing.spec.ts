import { test, expect } from '@playwright/test';
import { createConfirmedTestUser } from './fixtures/testUser';

// Production routing-defect fix (WORKLOG.md this date): `/` used to have no public branch at
// all -- any authenticated caller (a platform admin, most notably) landed on the internal admin
// dashboard, and no public marketing page existed to show an unauthenticated visitor either. This
// suite proves the real, end-to-end fix against a real running server (never demo mode), per
// TESTING.md §7. Role-priority-ordering edge cases (suspended orgs, tenant/owner precedence, etc.)
// are exhaustively covered at the unit level (lib/__tests__/destinationResolver.test.ts) --
// this suite proves the actual production symptom is gone, not every branch of that logic again.

test.describe('root domain (/) routing', () => {
  test('an unauthenticated visitor sees the public landing page, not a dashboard or login form', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The exact real regression: '/' must never redirect an unauthenticated visitor into any
    // authenticated app shell.
    expect(page.url()).toMatch(/\/$/);

    await expect(page.getByRole('link', { name: /sign in/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /start.*free trial/i }).first()).toBeVisible();

    // Never the internal admin/dashboard experience the bug report described.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByText(/^overview$/i)).toHaveCount(0);
  });

  test('the landing page pricing section shows the three real plans', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('link', { name: /pricing/i })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Starter', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Professional', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Business', exact: true })).toBeVisible();
  });

  test('a signed-in user with no organization is routed to onboarding, not the landing page', async ({
    page,
  }) => {
    const user = await createConfirmedTestUser('root-routing-onboarding');
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="password"]').fill(user.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/onboarding\/create-organization/, { timeout: 15_000 });

    // Re-visiting '/' directly while authenticated must redirect through the resolver again, not
    // show the public landing page to a signed-in user.
    await page.goto('/');
    await page.waitForURL(/\/onboarding\/create-organization/, { timeout: 15_000 });
  });

  test('a normal signed-in user cannot reach the platform-admin route', async ({ page }) => {
    const user = await createConfirmedTestUser('root-routing-admin-block');
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="password"]').fill(user.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });

    // getAdminSessionWithoutMfaCheck() returns null for this user (no platform_admin_users row)
    // -- the (super-admin) layout's own server-side check redirects them to their real
    // destination (onboarding, since this test user has no org) rather than showing any
    // FORBIDDEN/error page that would reveal the admin area exists.
    await page.goto('/platform-admin/overview');
    await page.waitForURL((url) => !url.pathname.startsWith('/platform-admin'), {
      timeout: 15_000,
    });
    await expect(page.getByText(/client directory|subscriptions|document processing/i)).toHaveCount(
      0,
    );
  });

  test('an unsafe absolute-URL next param is never followed by the auth callback', async ({
    request,
  }) => {
    const response = await request.get(
      '/auth/callback?next=' + encodeURIComponent('https://evil.example/phish'),
      { maxRedirects: 0 },
    );
    expect([301, 302, 303, 307, 308]).toContain(response.status());
    const location = response.headers()['location'] ?? '';
    expect(location).not.toContain('evil.example');
  });

  test('a protocol-relative //evil next param is never followed by the auth callback', async ({
    request,
  }) => {
    const response = await request.get(
      '/auth/callback?next=' + encodeURIComponent('//evil.example'),
      {
        maxRedirects: 0,
      },
    );
    expect([301, 302, 303, 307, 308]).toContain(response.status());
    const location = response.headers()['location'] ?? '';
    expect(location).not.toContain('evil.example');
  });
});
