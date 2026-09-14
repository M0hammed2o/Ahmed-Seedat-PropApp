import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Android sign-out must end ONLY that device's session (2026-09-14, Android release P0). Confirmed
// in production before the fix: the app's logout revoked a separate session of the same account,
// because Supabase Auth's logout defaults to scope=global. This pins both halves of the contract:
// the request apps/android sends (read from SupabaseAuthApi.kt), and what real Supabase Auth does
// with that exact request -- session A signs out, session B keeps working.

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const PASSWORD = 'TestPassw0rd!23';

const SUPABASE_AUTH_API_KT = fileURLToPath(
  new URL(
    '../../../android/app/src/main/java/za/co/proplyst/app/data/network/SupabaseAuthApi.kt',
    import.meta.url,
  ),
);

let supabaseReachable = false;
try {
  supabaseReachable = (await fetch(`${SUPABASE_URL}/auth/v1/health`)).ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

/** The logout scope apps/android actually sends, read from its Retrofit interface. */
function androidLogoutScope(): string {
  const source = readFileSync(SUPABASE_AUTH_API_KT, 'utf8');
  if (!/@POST\("auth\/v1\/logout"\)\s*suspend fun signOut\(/.test(source)) {
    throw new Error('signOut() not found in SupabaseAuthApi.kt');
  }
  const param = source.match(
    /@POST\("auth\/v1\/logout"\)\s*suspend fun signOut\(\s*@Query\("scope"\)\s*scope:\s*String\s*=\s*(\w+)\s*\)/,
  );
  if (!param) throw new Error('signOut() no longer sends a scope query parameter');
  const constant = source.match(new RegExp(`const val ${param[1]} = "([^"]+)"`));
  if (!constant) throw new Error(`scope constant ${param[1]} not found`);
  return constant[1]!;
}

describeIfSupabase('Android sign-out scope against real Supabase Auth', () => {
  const service: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let userId: string;
  let email: string;

  beforeAll(async () => {
    email = `android-logout-${randomUUID().slice(0, 8)}@test.propertyvault.example`;
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user!.id;
  });

  afterAll(async () => {
    if (userId) await service.auth.admin.deleteUser(userId);
  });

  /** One independent device session: a password sign-in, as the Android app performs it. */
  async function deviceSession() {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`sign-in failed: ${res.status}`);
    return { accessToken: body.access_token as string, refreshToken: body.refresh_token as string };
  }

  const refreshWorks = async (refreshToken: string) =>
    (
      await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
    ).ok;

  const logout = (accessToken: string, query: string) =>
    fetch(`${SUPABASE_URL}/auth/v1/logout${query}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });

  it('the Android app sends scope=local', () => {
    expect(androidLogoutScope()).toBe('local');
  });

  it("session A signing out with the app's request leaves session B valid, and A cannot refresh", async () => {
    const a = await deviceSession();
    const b = await deviceSession();

    const res = await logout(a.accessToken, `?scope=${androidLogoutScope()}`);
    expect(res.status).toBe(204);

    expect(await refreshWorks(b.refreshToken)).toBe(true);
    expect(await refreshWorks(a.refreshToken)).toBe(false);
  });

  it('why the parameter matters: the old request (no scope) revokes the other session too', async () => {
    const a = await deviceSession();
    const b = await deviceSession();

    expect((await logout(a.accessToken, '')).status).toBe(204);
    expect(await refreshWorks(b.refreshToken)).toBe(false);
  });
});
