import { test, expect } from '@playwright/test';

// Fast, no-DB-dependency smoke coverage for every unauthenticated/public route -- runs against the
// same real (non-demo) server as the rest of this suite, so a broken build/CSP/hydration issue on
// any of these entry points is caught even before a real signup is attempted.
test.describe('public pages', () => {
  test('login page renders the sign-in form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /welcome back|sign in/i }).or(page.locator('h1'))).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('register page renders the sign-up form', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(2); // password + confirm password
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
  });

  test('PWA manifest is reachable and well-formed', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest.name).toContain('Proplyst');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });

  test('service worker script is reachable', async ({ request }) => {
    const response = await request.get('/sw.js');
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('javascript');
  });

  test('offline fallback page renders', async ({ page }) => {
    await page.goto('/offline');
    await expect(page.getByText(/you're offline/i)).toBeVisible();
  });

  test('an unauthenticated visitor to a protected route is redirected to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(/\/login/);
  });
});
