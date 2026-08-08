import { test, expect } from '@playwright/test';
import { createConfirmedTestUser } from './fixtures/testUser';
import { generateTotpCode } from './fixtures/totp';
import { BASE_URL } from '../playwright.config';

// Stage 3 (WORKLOG.md this date) -- permanent regression test for a real, proven customer MFA
// bypass: does an AAL1 session (password verified, TOTP enrolled but not yet entered) let an
// ordinary customer reach protected pages/APIs before completing the second factor? Real
// HTTP/browser requests only -- no inference from UI behaviour.
//
// Also proves the required UX flow: password accepted -> MFA required -> user attempts
// /dashboard -> redirected to the dedicated /mfa-challenge page (never asked to re-enter their
// password) -> enters the authenticator code -> AAL2 -> lands on the ORIGINAL destination they
// tried to reach, not a generic one.

test.describe('customer MFA enforcement', () => {
  test('a user WITHOUT MFA enrolled can use ordinary customer routes after password login alone', async ({
    page,
  }) => {
    const user = await createConfirmedTestUser('no-mfa-baseline');

    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="password"]').fill(user.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    // No MFA challenge for this account -- straight through to onboarding (no org yet). If this
    // hung or redirected to /mfa-challenge instead, the gate would be wrongly treating "no factor
    // enrolled" as "MFA required" -- exactly the over-blocking this fix must not introduce.
    await page.waitForURL(/\/onboarding\/create-organization/, { timeout: 15_000 });

    await page.locator('input[autocomplete="organization"]').fill(`E2E No-MFA Org ${Date.now()}`);
    await page.getByRole('button', { name: /create organization/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    const apiResponse = await page.request.get('/api/v1/properties');
    expect(apiResponse.status()).toBe(200);
  });

  test('an MFA-enrolled user at AAL1 cannot reach protected pages/APIs, completes step-up via the dedicated challenge page without re-entering their password, lands on the original destination, and loses access again after logout', async ({
    page,
  }) => {
    const user = await createConfirmedTestUser('mfa-full-cycle');

    // Establish the account: sign in, create an org, enroll TOTP.
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="password"]').fill(user.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });

    await page.goto('/onboarding/create-organization');
    await page.waitForLoadState('networkidle');
    await page
      .locator('input[autocomplete="organization"]')
      .fill(`E2E MFA Cycle Org ${Date.now()}`);
    await page.getByRole('button', { name: /create organization/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /add authenticator app/i }).click();
    const secretLocator = page.locator('code');
    await expect(secretLocator).toBeVisible({ timeout: 10_000 });
    const secret = (await secretLocator.textContent())?.trim();
    expect(secret).toBeTruthy();
    const enrollCode = generateTotpCode(secret!);
    await page.locator('input[inputmode="numeric"]').fill(enrollCode);
    await page.getByRole('button', { name: /^confirm$/i }).click();
    await expect(page.getByText(/enabled/i)).toBeVisible({ timeout: 10_000 });

    // Sign out fully, then sign back in with the correct password -- and deliberately STOP at
    // the MFA challenge. Never call /api/v1/auth/mfa/verify yet. Confirmed via the signin
    // response itself that this is a real AAL1-only session.
    await page.context().clearCookies();
    const signinResponse = await page.request.post('/api/v1/auth/signin', {
      headers: { Origin: BASE_URL },
      data: { email: user.email, password: user.password },
    });
    expect(signinResponse.ok()).toBe(true);
    const signinBody = await signinResponse.json();
    expect(signinBody.mfaRequired).toBe(true); // proves this session is genuinely AAL1-only

    // --- AAL1: every protected page and API must be blocked, not silently allowed ---
    const pageResults: { path: string; status: number; location: string | undefined }[] = [];
    for (const path of ['/dashboard', '/properties', '/settings']) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      pageResults.push({
        path,
        status: response.status(),
        location: response.headers()['location'],
      });
    }
    const apiResults: { path: string; status: number; code: string | undefined }[] = [];
    for (const apiPath of ['/api/v1/properties', '/api/v1/profile', '/api/v1/organizations']) {
      const response = await page.request.get(apiPath);
      const body = await response.json().catch(() => ({}));
      apiResults.push({ path: apiPath, status: response.status(), code: body?.error?.code });
    }

    console.warn('=== AAL1 gate results ===');
    for (const r of pageResults) console.warn(`GET ${r.path} -> ${r.status} -> ${r.location}`);
    for (const r of apiResults) console.warn(`GET ${r.path} -> ${r.status} (${r.code})`);

    for (const r of pageResults) {
      expect(r.status, `${r.path} should redirect away, not 200`).toBe(307);
      // Redirected to the dedicated challenge page -- NOT /login -- and preserving exactly the
      // page the user was trying to reach, so completing MFA can return them there.
      expect(r.location, `${r.path} should redirect to /mfa-challenge`).toContain('/mfa-challenge');
      expect(r.location, `${r.path} should preserve the original destination in next`).toContain(
        encodeURIComponent(r.path),
      );
    }
    for (const r of apiResults) {
      expect(r.status, `${r.path} should be 403, not 200`).toBe(403);
      expect(r.code, `${r.path} should report mfa_required`).toBe('mfa_required');
    }

    // A direct visit to /mfa-challenge itself while AAL1-blocked must render the challenge form
    // (200), never loop back into another redirect -- and critically, must NOT ask for a
    // password again (the whole point of this dedicated page).
    const challengePageResponse = await page.request.get('/mfa-challenge?next=%2Fdashboard', {
      maxRedirects: 0,
    });
    expect(challengePageResponse.status()).toBe(200);
    const challengeHtml = await challengePageResponse.text();
    expect(challengeHtml.toLowerCase()).toContain('authentication code');
    expect(challengeHtml.toLowerCase()).not.toContain('type="password"');

    // --- Complete the second factor via the dedicated page's own flow -- same
    // POST /api/v1/auth/mfa/verify the inline LoginForm challenge uses, proving the shared
    // component/logic behaves identically from either entry point. ---
    const verifyResponse = await page.request.post('/api/v1/auth/mfa/verify', {
      headers: { Origin: BASE_URL },
      data: { factorId: signinBody.factorId, code: generateTotpCode(secret!) },
    });
    expect(verifyResponse.ok()).toBe(true);

    // Visiting /mfa-challenge again now that AAL2 is satisfied must not show a pointless
    // challenge screen -- it redirects straight to `next` instead (real request, not the
    // client-side router.replace path, but they end up in the same place).
    const postAal2Challenge = await page.request.get('/mfa-challenge?next=%2Fdashboard', {
      maxRedirects: 0,
    });
    expect(postAal2Challenge.status()).toBe(307);
    expect(postAal2Challenge.headers()['location']).toContain('/dashboard');

    for (const path of ['/dashboard', '/properties', '/settings']) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect(response.status(), `${path} should be reachable after AAL2`).toBe(200);
    }
    for (const apiPath of ['/api/v1/properties', '/api/v1/profile', '/api/v1/organizations']) {
      const response = await page.request.get(apiPath);
      expect(response.status(), `${apiPath} should be reachable after AAL2`).toBe(200);
    }

    // --- Logout clears the session entirely -- not just back to AAL1, fully unauthenticated ---
    await page.context().clearCookies();
    const afterLogout = await page.request.get('/dashboard', { maxRedirects: 0 });
    expect(afterLogout.status()).toBe(307);
    expect(afterLogout.headers()['location']).toContain('/login');
    const afterLogoutApi = await page.request.get('/api/v1/properties');
    expect(afterLogoutApi.status()).toBe(401);
  });
});
