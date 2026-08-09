import { expect, type APIRequestContext } from '@playwright/test';
import { BASE_URL } from '../../playwright.config';

// Production signup/onboarding (WORKLOG.md this date). `createConfirmedTestUser()` seeds an
// account via the Supabase Admin API, bypassing RegisterForm entirely -- so, correctly, it now
// arrives with neither legal consent nor a completed profile recorded, exactly like a real
// first-time OAuth sign-in. Every pre-existing E2E test that only cares about testing something
// ELSE (MFA, root routing, Super Admin separation, ...) needs this called once, right after
// establishing a session, so it isn't itself gated to /legal-consent or /complete-account before
// it can reach whatever it's actually testing.
export async function completeLegalConsentAndProfile(request: APIRequestContext): Promise<void> {
  const consentResponse = await request.post('/api/v1/legal-consent', {
    headers: { Origin: BASE_URL },
  });
  expect(consentResponse.ok()).toBe(true);

  const profileResponse = await request.post('/api/v1/profile/complete', {
    headers: { Origin: BASE_URL },
    data: { firstName: 'E2E', lastName: 'Test', phone: '0821234567' },
  });
  expect(profileResponse.ok()).toBe(true);
}
