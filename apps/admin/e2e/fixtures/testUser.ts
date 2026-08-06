// Seeds a real, pre-confirmed Supabase Auth user via the Admin API (service-role), mirroring the
// exact pattern apps/admin/lib/supabase/__tests__/server.test.ts already uses for its own
// real-local-Supabase integration tests. Seeding via API + testing via UI (rather than driving the
// real signup form, which needs a live email-confirmation round trip -- supabase/config.toml has
// [auth.email] confirmations ON) is standard E2E practice, not a shortcut around what's being
// tested: everything AFTER "a confirmed account exists" (login, org creation, property creation)
// still goes through real UI interactions and real API/RLS enforcement.

const SUPABASE_URL = 'http://127.0.0.1:54321';

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

export async function createConfirmedTestUser(label: string): Promise<TestUser> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set -- playwright.config.ts should inject it into the webServer env, but tests also need it directly.');
  }

  const email = `e2e-${label}-${Date.now()}@propertyvault.example`;
  const password = 'TestPassw0rd!23';

  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create test user via Supabase Admin API (${response.status}): ${body}`);
  }
  const created = (await response.json()) as { id: string };

  return { id: created.id, email, password };
}
