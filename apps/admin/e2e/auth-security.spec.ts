import { test, expect } from '@playwright/test';
import { createConfirmedTestUser } from './fixtures/testUser';
import { generateTotpCode } from './fixtures/totp';
import { BASE_URL } from '../playwright.config';

// Real coverage for Stage 7's auth security work (commercial-launch execution plan,
// TECHNICAL_DEBT_REGISTER.md TD-31 + TOTP MFA) -- against the real local Supabase instance, never
// demo mode, same posture as signup-and-onboarding.spec.ts.

test('signin is rate-limited after repeated failed attempts', async ({ request }) => {
  const user = await createConfirmedTestUser('ratelimit');

  // RATE_LIMITS.loginAttemptsPerMinute = 10 (packages/config/src/limits.ts) -- 11 rapid wrong-
  // password attempts against the real route should trip it on (at latest) the 11th.
  // Playwright's APIRequestContext is a raw HTTP client, not a browser -- it doesn't
  // automatically attach an Origin header the way a real browser fetch() would, so this sets one
  // explicitly to simulate a legitimate same-origin call (this test is about rate limiting, not
  // proxy.ts's separate CSRF check, which has its own dedicated coverage in __tests__/proxy.test.ts).
  // A synthetic, unique X-Forwarded-For isolates this test's intentionally-exhausted rate-limit
  // bucket to itself -- requestIp() (lib/rateLimit.ts) reads this header first, and every real
  // browser-driven test in this suite shares the same actual machine IP; without this, exhausting
  // the IP-keyed bucket here would also lock this test runner out of every OTHER auth test that
  // runs within the same 60-second window (found live this session: it did exactly that).
  const syntheticIp = `10.42.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  let sawRateLimit = false;
  for (let i = 0; i < 11; i++) {
    const response = await request.post('/api/v1/auth/signin', {
      headers: { Origin: BASE_URL, 'X-Forwarded-For': syntheticIp },
      data: { email: user.email, password: 'definitely-the-wrong-password' },
    });
    if (response.status() === 429) {
      sawRateLimit = true;
      break;
    }
    expect(response.status()).toBe(401); // wrong password, correctly rejected, not yet rate-limited
  }
  expect(sawRateLimit).toBe(true);
});

test('a user can enroll TOTP MFA, then sign in with a real generated code', async ({ page }) => {
  const user = await createConfirmedTestUser('mfa');

  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });

  // /settings lives under the (dashboard) route group, which requires an active org membership
  // (redirects to onboarding otherwise, same check signup-and-onboarding.spec.ts's own account
  // goes through) -- a brand-new account has none yet, so one is created first.
  await page.goto('/onboarding/create-organization');
  await page.waitForLoadState('networkidle');
  await page.locator('input[autocomplete="organization"]').fill(`E2E MFA Test Org ${Date.now()}`);
  await page.getByRole('button', { name: /create organization/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /add authenticator app/i }).click();

  // The panel renders the raw base32 secret as a fallback for "can't scan the QR code" --
  // reading that same text is exactly how a real user's authenticator app would derive its codes
  // from the QR code, just via text instead of a camera.
  const secretLocator = page.locator('code');
  await expect(secretLocator).toBeVisible({ timeout: 10_000 });
  const secret = (await secretLocator.textContent())?.trim();
  expect(secret).toBeTruthy();

  const enrollCode = generateTotpCode(secret!);
  await page.locator('input[inputmode="numeric"]').fill(enrollCode);
  await page.getByRole('button', { name: /^confirm$/i }).click();

  // Enrollment confirmed: the panel switches from the QR-code form to the "enabled" state.
  await expect(page.getByText(/enabled/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /remove/i })).toBeVisible();

  // Sign out (clear the session cookie directly -- equivalent to using a real sign-out control,
  // and avoids this test depending on exactly where that control lives in the header/menu) and
  // sign back in with the same credentials -- this time a real MFA challenge must appear.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page.getByText(/enter your authentication code/i)).toBeVisible({ timeout: 10_000 });
  const loginCode = generateTotpCode(secret!);
  await page.locator('input[inputmode="numeric"]').fill(loginCode);
  await page.getByRole('button', { name: /^verify$/i }).click();

  // A completed MFA challenge signs the user fully in -- this account already has an org
  // (created above), so '/' resolves straight to '/dashboard'.
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
});
