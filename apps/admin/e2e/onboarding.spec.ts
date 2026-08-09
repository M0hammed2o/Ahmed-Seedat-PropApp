import { test, expect, type APIRequestContext } from '@playwright/test';
import { createConfirmedTestUser } from './fixtures/testUser';
import { completeLegalConsentAndProfile } from './fixtures/onboarding';
import { BASE_URL } from '../playwright.config';

// Production signup/onboarding (WORKLOG.md this date). Real HTTP/browser requests against the
// real local Supabase instance, never demo mode -- same posture as every other spec in this
// suite. `createConfirmedTestUser()` seeds a confirmed account via the Supabase Admin API,
// bypassing RegisterForm entirely -- this is deliberate, not a shortcut: it produces exactly the
// same state a real OAuth first-time sign-in leaves behind (an authenticated user who never saw
// RegisterForm's consent checkboxes, no profile filled in), which is precisely the scenario the
// legal-consent/profile-completion gates exist to catch. Google/Apple OAuth are not configured in
// this environment (TECHNICAL_DEBT_REGISTER.md TD-29) so a real OAuth round trip cannot be driven
// here -- this is the closest faithful substitute, a disclosed one, not silently treated as
// equivalent to a real provider round trip.

async function signIn(request: APIRequestContext, email: string, password: string) {
  const response = await request.post('/api/v1/auth/signin', {
    headers: { Origin: BASE_URL },
    data: { email, password },
  });
  expect(response.ok()).toBe(true);
}

// Playwright's APIRequestContext (both the standalone `request` fixture and `page.request`) is a
// raw HTTP client -- unlike a real browser fetch(), it never attaches an Origin header on its
// own, so every mutating call in this file must set one explicitly to pass proxy.ts's CSRF check
// (found live writing these tests: the first version omitted this and every POST here failed
// with 403 csrf_origin_mismatch -- a test bug, not an app bug, and good independent proof the
// CSRF check is actually wired up for these new routes).
async function acceptLegalConsent(request: APIRequestContext) {
  const response = await request.post('/api/v1/legal-consent', { headers: { Origin: BASE_URL } });
  expect(response.ok()).toBe(true);
}

test.describe('legal consent + profile completion gating', () => {
  test('a freshly-confirmed user with no consent recorded (simulating OAuth) is gated to /legal-consent before anything else', async ({
    request,
  }) => {
    const user = await createConfirmedTestUser('onb-consent');
    await signIn(request, user.email, user.password);

    const response = await request.get('/dashboard', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()['location']).toContain('/legal-consent');
  });

  test('a user with consent recorded but no profile is gated to /complete-account, not /legal-consent again', async ({
    request,
  }) => {
    const user = await createConfirmedTestUser('onb-profile');
    await signIn(request, user.email, user.password);

    await acceptLegalConsent(request);

    const response = await request.get('/dashboard', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()['location']).toContain('/complete-account');
    expect(response.headers()['location']).not.toContain('/legal-consent');
  });

  test('next is preserved through both the consent and profile-completion hops', async ({
    request,
  }) => {
    const user = await createConfirmedTestUser('onb-next');
    await signIn(request, user.email, user.password);

    const first = await request.get('/settings', { maxRedirects: 0 });
    expect(first.status()).toBe(307);
    expect(first.headers()['location']).toContain('/legal-consent');
    expect(first.headers()['location']).toContain(encodeURIComponent('/settings'));

    await acceptLegalConsent(request);

    const second = await request.get('/settings', { maxRedirects: 0 });
    expect(second.status()).toBe(307);
    expect(second.headers()['location']).toContain('/complete-account');
    expect(second.headers()['location']).toContain(encodeURIComponent('/settings'));
  });

  test('rejects an invalid phone number and accepts a valid South African local-format number', async ({
    request,
  }) => {
    const user = await createConfirmedTestUser('onb-phone');
    await signIn(request, user.email, user.password);
    await acceptLegalConsent(request);

    const invalid = await request.post('/api/v1/profile/complete', {
      headers: { Origin: BASE_URL },
      data: { firstName: 'Jane', lastName: 'Doe', phone: 'not-a-real-number' },
    });
    expect(invalid.status()).toBe(400);
    const invalidBody = await invalid.json();
    expect(invalidBody.error.field_errors.phone).toBeTruthy();

    const valid = await request.post('/api/v1/profile/complete', {
      headers: { Origin: BASE_URL },
      data: { firstName: 'Jane', lastName: 'Doe', phone: '0821234567' },
    });
    expect(valid.ok()).toBe(true);
  });

  test('a fully completed user reaches org onboarding directly -- no gate, no loop', async ({
    request,
  }) => {
    const user = await createConfirmedTestUser('onb-complete');
    await signIn(request, user.email, user.password);
    await acceptLegalConsent(request);
    await request.post('/api/v1/profile/complete', {
      headers: { Origin: BASE_URL },
      data: { firstName: 'Jane', lastName: 'Doe', phone: '0821234567' },
    });

    const response = await request.get('/dashboard', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()['location']).toContain('/onboarding/create-organization');
  });

  test('the completed profile does not loop back -- a second /complete-account visit redirects onward, does not re-show the form', async ({
    request,
  }) => {
    const user = await createConfirmedTestUser('onb-noloop');
    await signIn(request, user.email, user.password);
    await acceptLegalConsent(request);
    await request.post('/api/v1/profile/complete', {
      headers: { Origin: BASE_URL },
      data: { firstName: 'Jane', lastName: 'Doe', phone: '0821234567' },
    });

    const response = await request.get('/complete-account?next=%2Fdashboard', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()['location']).toContain('/dashboard');
  });

  test('an unauthenticated visitor to /legal-consent or /complete-account is sent to /login, not shown the form', async ({
    request,
  }) => {
    const consentPage = await request.get('/legal-consent', { maxRedirects: 0 });
    expect(consentPage.status()).toBe(307);
    expect(consentPage.headers()['location']).toContain('/login');

    const profilePage = await request.get('/complete-account', { maxRedirects: 0 });
    expect(profilePage.status()).toBe(307);
    expect(profilePage.headers()['location']).toContain('/login');
  });
});

test.describe('routing precedence with MFA', () => {
  // Confirms consent/profile gates never intercept a request that MFA should catch first -- MFA
  // enforcement itself (AAL1 -> /mfa-challenge) is exhaustively covered by e2e/mfa-enforcement.spec.ts;
  // this only proves the ORDERING (MFA before consent/profile) still holds after this stage's changes.
  test('MFA still gates a not-yet-stepped-up session before the consent/profile gates ever run', async ({
    page,
    request,
  }) => {
    const user = await createConfirmedTestUser('onb-mfa-order');
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="password"]').fill(user.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });

    // Complete consent + profile first -- createConfirmedTestUser() bypasses RegisterForm, so
    // this account starts with neither; without this, /onboarding/create-organization's own gate
    // (added this stage) would redirect to /legal-consent instead of rendering the org form.
    await completeLegalConsentAndProfile(page.request);

    await page.goto('/onboarding/create-organization');
    await page.waitForLoadState('networkidle');
    await page
      .locator('input[autocomplete="organization"]')
      .fill(`E2E Onboarding MFA-order Org ${Date.now()}`);
    await page.getByRole('button', { name: /create organization/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /add authenticator app/i }).click();
    const secretLocator = page.locator('code');
    await expect(secretLocator).toBeVisible({ timeout: 10_000 });
    const secret = (await secretLocator.textContent())?.trim();
    const { generateTotpCode } = await import('./fixtures/totp');
    await page.locator('input[inputmode="numeric"]').fill(generateTotpCode(secret!));
    await page.getByRole('button', { name: /^confirm$/i }).click();
    await expect(page.getByText(/enabled/i)).toBeVisible({ timeout: 10_000 });

    await page.context().clearCookies();
    await signIn(request, user.email, user.password);

    // AAL1 only (password verified, TOTP not yet entered) -- this account already has org,
    // consent, and profile complete (it reached /settings above), so if the ordering were wrong
    // (consent/profile checked before MFA), this would 200 or redirect somewhere other than
    // /mfa-challenge. It must go to /mfa-challenge, proving MFA is still checked first.
    const response = await request.get('/dashboard', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()['location']).toContain('/mfa-challenge');
  });
});
