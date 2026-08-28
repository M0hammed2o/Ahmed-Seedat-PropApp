import { test, expect } from '@playwright/test';
import { createConfirmedTestUser } from './fixtures/testUser';
import { createConfirmedPlatformAdmin } from './fixtures/platformAdmin';
import { generateTotpCode } from './fixtures/totp';
import { completeLegalConsentAndProfile } from './fixtures/onboarding';
import { BASE_URL } from '../playwright.config';

// Super Admin separation (WORKLOG.md this date) -- against the real local Supabase instance,
// never demo mode, same posture as every other real-backend spec in this suite. Covers the exact
// scenarios named in that spec's own item 12.

test.describe('Super Admin separation', () => {
  test('a platform admin without MFA cannot enter, and is sent to enroll', async ({ page }) => {
    const admin = await createConfirmedPlatformAdmin('no-mfa');

    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="email"]').fill(admin.email);
    await page.locator('input[type="password"]').fill(admin.password);
    await page.getByRole('button', { name: /sign in/i }).click();

    // No TOTP factor exists yet, so /api/v1/auth/signin completes sign-in directly
    // (mfaRequired: false) -- but the resulting session is still only AAL1, and
    // getAdminSession() now requires AAL2 to ever return non-null.
    await page.waitForURL(/\/platform-admin\/mfa-setup/, { timeout: 30_000 });
    // First-ever visit to this route in a freshly started dev server -- dev-mode Turbopack
    // compiles it on demand. Confirmed live (not assumed): the failure screenshot before this
    // fix showed a blank page with Next.js's own "Rendering..." dev-mode badge in the corner,
    // the same real cold-compile delay documented elsewhere in this suite
    // (signup-and-onboarding.spec.ts's own comment) -- `networkidle` alone doesn't reliably wait
    // it out, so this assertion gets the same generous timeout that route's own first-visit
    // assertion already uses.
    await expect(page.getByText(/two-factor authentication required/i)).toBeVisible({
      timeout: 30_000,
    });

    // The dashboard itself must never render for this session.
    await page.goto('/platform-admin/overview');
    await page.waitForURL(/\/platform-admin\/mfa-setup/, { timeout: 15_000 });
  });

  test('a platform admin with MFA enrolled can enter the Super Admin interface', async ({
    page,
  }) => {
    const admin = await createConfirmedPlatformAdmin('with-mfa');

    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="email"]').fill(admin.email);
    await page.locator('input[type="password"]').fill(admin.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/platform-admin\/mfa-setup/, { timeout: 15_000 });

    // Same cold-compile delay as the previous test -- generous timeout, not networkidle.
    await page.getByRole('button', { name: /add authenticator app/i }).click({ timeout: 30_000 });
    const secretLocator = page.locator('code');
    await expect(secretLocator).toBeVisible({ timeout: 10_000 });
    const secret = (await secretLocator.textContent())?.trim();
    expect(secret).toBeTruthy();

    const code = generateTotpCode(secret!);
    await page.locator('input[inputmode="numeric"]').fill(code);
    await page.getByRole('button', { name: /^confirm$/i }).click();

    // challengeAndVerify() promotes this session straight to AAL2 (Supabase's own documented
    // behaviour, see api/v1/auth/mfa/enroll/route.ts's comment) -- MfaSetupClient's onVerified
    // callback then redirects here automatically, no separate sign-in-again step required.
    await page.waitForURL(/\/platform-admin\/overview/, { timeout: 15_000 });
    await expect(page.getByText(/two-factor authentication required/i)).toHaveCount(0);
  });

  test('a normal customer visiting a guessed admin URL is redirected without any hint the admin area exists', async ({
    page,
  }) => {
    const user = await createConfirmedTestUser('admin-guess');
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="password"]').fill(user.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });

    await page.goto('/platform-admin/overview');
    await page.waitForURL((url) => !url.pathname.startsWith('/platform-admin'), {
      timeout: 15_000,
    });
    await page.waitForLoadState('networkidle');

    // innerText (not textContent/page.content()) -- reflects only what a real visitor would
    // actually SEE rendered. textContent includes inline <script> tag text nodes verbatim, and
    // Next.js's own RSC hydration payload for EVERY page in this app happens to serialize a
    // "forbidden" JSON key as part of its always-present not-found/error-boundary wiring
    // (`"forbidden":"$undefined"`) -- a real false positive this exact assertion hit before this
    // fix, on a page that was, in fact, correctly and silently redirected with no visible hint at
    // all.
    const visibleText = (await page.locator('body').innerText()) ?? '';
    expect(visibleText.toLowerCase()).not.toContain('forbidden');
    expect(visibleText.toLowerCase()).not.toContain('something went wrong');
    expect(visibleText).not.toMatch(/super\s*admin/i);
  });

  test('a normal customer dashboard contains no link into the Super Admin area', async ({
    page,
  }) => {
    const user = await createConfirmedTestUser('nav-check');
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="password"]').fill(user.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });

    // createConfirmedTestUser() bypasses RegisterForm (production signup/onboarding, WORKLOG.md
    // this date), so this account starts with no recorded consent/profile -- complete both first,
    // or this navigation would land on /legal-consent instead.
    await completeLegalConsentAndProfile(page.request);
    await page.goto('/onboarding/create-organization');
    await page.waitForLoadState('networkidle');
    await page.locator('input[autocomplete="organization"]').fill(`E2E Nav Check ${Date.now()}`);
    await page.getByRole('button', { name: /create organization/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    const adminLinkCount = await page.locator('a[href^="/platform-admin"]').count();
    expect(adminLinkCount).toBe(0);
  });

  test('a privileged admin API route rejects an AAL1 (MFA-incomplete) platform admin session', async ({
    page,
    request,
  }) => {
    const admin = await createConfirmedPlatformAdmin('api-block');

    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="email"]').fill(admin.email);
    await page.locator('input[type="password"]').fill(admin.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/platform-admin\/mfa-setup/, { timeout: 15_000 });
    await page.waitForLoadState('networkidle');

    // Same browser context -- the cookie-based session from the sign-in above is attached
    // automatically to this API request, exactly as a real fetch() from that page would carry it.
    const response = await request.get(`${BASE_URL}/api/v1/admin/organizations`);
    expect(response.status()).toBe(403);
  });
});
