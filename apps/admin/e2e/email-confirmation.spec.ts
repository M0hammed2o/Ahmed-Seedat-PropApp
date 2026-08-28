import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { BASE_URL } from '../playwright.config';

// Email-confirmation cross-device-safe rewrite (WORKLOG.md this date). Drives the REAL
// /auth/confirm UI against a real local Supabase instance -- never demo mode. A genuine token_hash
// is minted via the Supabase Admin API's generate_link (type: 'signup'), the same primitive
// Supabase's own confirmation email is built from -- this is not a shortcut around what's being
// tested (the actual email round trip can't be driven in CI at all), it's the same "seed via API,
// then drive the thing actually under test through real UI" pattern e2e/fixtures/testUser.ts
// already documents and uses for every other auth-adjacent spec in this suite.

const SUPABASE_URL = 'http://127.0.0.1:54321';

async function createUnconfirmedUser(label: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set for this test run.');
  }
  const email = `e2e-confirm-flow-${label}-${Date.now()}@propertyvault.example`;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'signup', email, password: 'TestPassw0rd!23' }),
  });
  if (!response.ok) {
    throw new Error(`generate_link failed (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json()) as { id: string; hashed_token: string };
  return { userId: body.id, email, password: 'TestPassw0rd!23', tokenHash: body.hashed_token };
}

async function acceptLegalConsentIfShown(page: Page, request: APIRequestContext) {
  await page.waitForLoadState('networkidle');
  if (page.url().includes('/legal-consent')) {
    const consentResponse = await request.post('/api/v1/legal-consent', {
      headers: { Origin: BASE_URL },
    });
    expect(consentResponse.ok()).toBe(true);

    // Navigate directly rather than via '/' -- this test's own job is to exercise the real
    // /complete-account form specifically, not re-prove resolveAuthenticatedDestination()'s
    // redirect chaining, which is pre-existing behavior this task doesn't touch. Verified by a
    // direct curl reproduction (WORKLOG.md this date) that the backend itself is correct: once
    // consent is recorded, a raw GET /complete-account returns 200 immediately, never a redirect.
    await page.goto('/complete-account');
    await page.waitForLoadState('networkidle');
  }
}

test.describe('Email confirmation (cross-device-safe rewrite)', () => {
  test('GET does not consume the token -- confirmation only happens on explicit button click', async ({
    page,
  }) => {
    const { tokenHash } = await createUnconfirmedUser('get-safe');

    // Two plain GETs to the confirm page -- mirrors what an email security scanner or link-preview
    // fetcher does. Neither should show a success/confirmed state, and the token must still be
    // valid afterward.
    await page.goto(`/auth/confirm?token_hash=${tokenHash}&type=signup`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/email confirmed/i)).toHaveCount(0);
    await expect(page.getByText(/already confirmed/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /confirm email address/i })).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /confirm email address/i })).toBeVisible();

    // Only now does the real, explicit action happen -- and it must still succeed, proving the two
    // prior GETs never spent the token.
    await page.getByRole('button', { name: /confirm email address/i }).click();
    await expect(page.getByText(/email confirmed/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/invalid or has expired/i)).toHaveCount(0);
  });

  test('full happy path: confirm once -> success -> complete account -> dashboard/onboarding -> logout -> login again', async ({
    page,
  }) => {
    const { tokenHash, email, password } = await createUnconfirmedUser('happy-path');

    await page.goto(`/auth/confirm?token_hash=${tokenHash}&type=signup`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /confirm email address/i }).click();
    await expect(page.getByText(/email confirmed/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /continue to proplyst/i }).click();
    // Real root-cause of an earlier flaky version of this test (WORKLOG.md this date): waiting
    // only for "not /auth/confirm" is satisfied the instant router.replace('/') fires, before the
    // server has resolved '/' 's own further redirect (through resolveAuthenticatedDestination())
    // to wherever this fresh user actually belongs. That left a real race where this test's own
    // /legal-consent check ran too early, saw '/' rather than the eventual '/legal-consent', and
    // skipped consent entirely. Waiting for one of the actual possible terminal destinations closes
    // that race instead of adding more blind waits.
    await page.waitForURL(/\/legal-consent|\/complete-account|\/onboarding|\/dashboard/, {
      timeout: 15_000,
    });
    await page.waitForLoadState('networkidle');

    // page.request (not the standalone `request` fixture) -- it shares this browser context's
    // session cookies, which the legal-consent POST below must carry to be authenticated as the
    // same just-confirmed user. Matches e2e/fixtures/onboarding.ts's own established call shape.
    await acceptLegalConsentIfShown(page, page.request);
    await expect(page).toHaveURL(/\/complete-account/, { timeout: 15_000 });

    await page.getByLabel('First name').fill('E2E');
    await page.getByLabel('Last name').fill('Confirm');
    await page.getByLabel(/phone/i).fill('0821234567');
    await page.getByRole('button', { name: /save|continue|complete/i }).click();

    // No existing org/tenant/owner identity yet -- resolveAuthenticatedDestination() sends a
    // brand-new confirmed customer to onboarding, not a dashboard that doesn't exist for them yet.
    await page.waitForURL(/\/onboarding\/choose-plan|\/dashboard/, { timeout: 15_000 });

    // Clear the session (sign-out in this app is client-side only, supabase.auth.signOut() via
    // AppShell.tsx -- clearing cookies directly is the equivalent, standard Playwright way to
    // reach the same signed-out state without depending on that UI's own menu structure). A
    // completely fresh login afterward proves the session this flow established was a real,
    // durable one -- not merely client-side UI state left over from the confirm step.
    await page.context().clearCookies();

    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
  });

  test('clicking confirm twice on the same page shows a graceful state, never the old generic error', async ({
    page,
  }) => {
    const { tokenHash } = await createUnconfirmedUser('double-click');

    await page.goto(`/auth/confirm?token_hash=${tokenHash}&type=signup`);
    await page.waitForLoadState('networkidle');
    const confirmButton = page.getByRole('button', { name: /confirm email address/i });
    await confirmButton.click();
    await expect(page.getByText(/email confirmed/i)).toBeVisible({ timeout: 10_000 });

    // Revisit the identical URL (simulates re-opening the same email link a second time, on the
    // same browser) -- must be a calm, reassuring state, never "This link is invalid or has
    // expired." verbatim (the exact regression this task fixes).
    await page.goto(`/auth/confirm?token_hash=${tokenHash}&type=signup`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /confirm email address/i }).click();
    await expect(page.getByText(/already confirmed|confirmation link expired/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText('This link is invalid or has expired.', { exact: true }),
    ).toHaveCount(0);
  });

  test('a malformed confirmation link shows "Invalid confirmation link" without calling the API', async ({
    page,
  }) => {
    await page.goto('/auth/confirm');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/invalid confirmation link/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm email address/i })).toHaveCount(0);
  });
});
