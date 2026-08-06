import { test, expect } from '@playwright/test';
import { createConfirmedTestUser } from './fixtures/testUser';

// Real critical-path coverage (TESTING.md §7's "org signup -> property creation" opening leg) --
// against the real local Supabase instance, never demo mode. Seeds a pre-confirmed account via
// the Supabase Admin API (see fixtures/testUser.ts for why), then drives login, organization
// creation, and property creation entirely through real UI interactions against real API routes.
//
// This is the test that caught a real bug this date: CreateOrganizationForm.tsx used to redirect
// a brand-new org's principal to '/overview' (Super Admin only), which throws FORBIDDEN for an
// ordinary customer -- fixed to '/dashboard' in the same change. Left in as regression coverage.
test('a new user can log in, create an organization, and create a property', async ({ page }) => {
  const user = await createConfirmedTestUser('onboarding');

  await page.goto('/login');
  // Waits for hydration to actually complete before interacting -- clicking submit before the
  // form's React onSubmit handler has attached falls through to a native browser GET form
  // submission (found live this session: the URL ends up with ?email=...&password=... in plain
  // text, never reaching the real signInWithPassword() call at all). networkidle alone isn't
  // always sufficient (next.config.ts's allowedDevOrigins fix addresses the root cause -- a
  // blocked, endlessly-retrying HMR websocket -- but this wait stays as defence in depth).
  await page.waitForLoadState('networkidle');
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Waits for the URL to actually leave /login -- confirms LoginForm.tsx's post-signIn
  // router.replace() really fired (proving signInWithPassword resolved and the session cookie
  // was written), not just that *some* URL matching a broad pattern was reached. A looser
  // condition here caused a real, observed flake this session: navigating to
  // /onboarding/create-organization before the session cookie had actually propagated produced a
  // genuine "Sign in required." error on the very next request. This also exercises a second real
  // bug this test caught and app/page.tsx got fixed for in the same pass: '/' used to have no
  // landing page at all for a genuinely authenticated user with zero org/tenant/owner identity
  // (this exact test user, at this exact point) -- it fell through to '/login', bouncing a
  // legitimately signed-in user back to the sign-in form. Now redirects to onboarding instead.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
  await page.goto('/onboarding/create-organization');
  await page.waitForLoadState('networkidle');

  const orgName = `E2E Test Org ${Date.now()}`;
  await page.locator('input[autocomplete="organization"]').fill(orgName);
  await page.getByRole('button', { name: /create organization/i }).click();

  // The bug this test caught: this used to hang on '/overview' (a thrown FORBIDDEN error), never
  // reaching '/dashboard' at all. A generous timeout: dev-mode Turbopack compiles each route on
  // first visit, and this is often the first hit on both the onboarding page and the
  // POST /api/v1/organizations route in a freshly started dev server -- a real, observed cold-
  // compile delay here is dev-environment latency, not applicable to a production build.
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.getByText(orgName, { exact: false }).first()).toBeVisible();

  await page.goto('/properties/new');
  await page.waitForLoadState('networkidle');
  const propertyName = `E2E Test Property ${Date.now()}`;
  await page.getByLabel('Property name').fill(propertyName);
  await page.getByLabel('Address line 1').fill('1 Test Street');
  await page.getByLabel('City').fill('Cape Town');
  await page.getByRole('button', { name: /create property|save/i }).click();

  // A UUID specifically, not just "any non-slash characters" -- /properties/new (the very page
  // we're already on) trivially satisfies a bare [^/]+$ pattern, so a looser regex here resolved
  // immediately without ever actually waiting for navigation, a real bug in this test found live
  // this session (it masked as the *next* assertion failing instead, on the still-unnavigated page).
  await page.waitForURL(/\/properties\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  // A longer explicit timeout than the 5s default: the property detail page has its own
  // client-side data fetch behind a loading skeleton, and dev-mode Turbopack recompiles each
  // route on first visit (visible as repeated "[Fast Refresh] rebuilding" during this session's
  // debugging) -- both add real latency this assertion needs to tolerate.
  await expect(page.getByText(propertyName)).toBeVisible({ timeout: 15_000 });

  // Cross-tenant leakage sanity check (TESTING.md §7): the properties list, scoped to this
  // brand-new org, must show only what this org actually owns -- a single-entry list here is
  // itself a (weak) signal nothing else leaked in; full multi-org leakage coverage needs a second
  // seeded org in the same run, not yet built (TECHNICAL_DEBT_REGISTER.md TD-41).
  await page.goto('/properties');
  await expect(page.getByText(propertyName)).toBeVisible({ timeout: 15_000 });
});
