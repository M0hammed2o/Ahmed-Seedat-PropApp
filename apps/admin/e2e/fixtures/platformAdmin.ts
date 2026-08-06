import { createConfirmedTestUser, type TestUser } from './testUser';

const SUPABASE_URL = 'http://127.0.0.1:54321';

/**
 * Seeds a real, confirmed auth user AND a real platform_admin_users row for them -- the same
 * "seed via Admin API/service-role REST, test through real UI" pattern testUser.ts already
 * establishes. platform_admin_users has zero RLS policies (service-role only, by design -- see
 * lib/auth.ts's own comment), so this uses a raw PostgREST insert with the service-role key
 * rather than the Supabase JS client, matching the direct-fetch style testUser.ts already uses
 * for the same reason (no client instantiation needed for a single one-off insert).
 */
export async function createConfirmedPlatformAdmin(
  label: string,
  role: 'super_admin' | 'support_admin' | 'operations_admin' | 'read_only_admin' = 'super_admin',
): Promise<TestUser> {
  const user = await createConfirmedTestUser(label);

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set -- see fixtures/testUser.ts.');
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/platform_admin_users`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      auth_user_id: user.id,
      role,
      display_name: `E2E Platform Admin (${label})`,
      is_active: true,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to seed platform_admin_users row (${response.status}): ${body}`);
  }

  return user;
}
