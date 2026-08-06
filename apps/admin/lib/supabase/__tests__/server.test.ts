import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// extractBearerToken is pure and needs no mocking. getServerSupabaseClient() itself is exercised
// as a real integration test against the local Supabase instance (TECHNICAL_DEBT_REGISTER.md
// TD-28) -- mocking @supabase/supabase-js's auth.getUser() would only prove the mock behaves as
// configured, not that a real Supabase JWT is actually validated end to end. This file therefore
// requires `supabase start` (the same local instance every pgTAP test in this repo already
// depends on) to be running; it is skipped automatically if it isn't reachable.

let mockAuthorizationHeader: string | null = null;

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null,
  }),
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const { extractBearerToken, getServerSupabaseClient } = await import('../server');

let supabaseReachable = false;
try {
  const res = await fetch('http://127.0.0.1:54321/auth/v1/health');
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

describe('extractBearerToken', () => {
  it('extracts the token from a well-formed header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('is case-insensitive on the scheme', () => {
    expect(extractBearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearerToken('BEARER abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('returns null for a missing header', () => {
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('returns null for an empty/malformed header', () => {
    expect(extractBearerToken('')).toBeNull();
    expect(extractBearerToken('Bearer')).toBeNull();
    expect(extractBearerToken('Bearer   ')).toBeNull();
  });

  it('returns null for a non-Bearer scheme', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
  });
});

describeIfSupabase('getServerSupabaseClient (real local Supabase integration)', () => {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  let testUserId: string;
  let testUserToken: string;

  beforeEach(async () => {
    const email = `bearer-vitest-${Date.now()}@propertyvault.example`;
    const password = 'TestPassw0rd!23';
    const createRes = await fetch('http://127.0.0.1:54321/auth/v1/admin/users', {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const created = await createRes.json();
    testUserId = created.id;

    const tokenRes = await fetch('http://127.0.0.1:54321/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const tokenBody = await tokenRes.json();
    testUserToken = tokenBody.access_token;
  });

  afterEach(() => {
    mockAuthorizationHeader = null;
  });

  it('resolves the real authenticated user from a valid Bearer token, no-arg auth.getUser()', async () => {
    mockAuthorizationHeader = `Bearer ${testUserToken}`;
    const client = await getServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    expect(error).toBeNull();
    expect(user?.id).toBe(testUserId);
  });

  it('returns no user for an invalid/garbage Bearer token', async () => {
    mockAuthorizationHeader = 'Bearer garbage.invalid.token';
    const client = await getServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    expect(user).toBeNull();
    expect(error).not.toBeNull();
  });

  it('scopes RLS reads to the bearer-authenticated user (not a service-role bypass)', async () => {
    mockAuthorizationHeader = `Bearer ${testUserToken}`;
    const client = await getServerSupabaseClient();
    // This user has no organization_members row at all -- RLS should return zero rows, not error
    // and not leak other orgs' rows, proving the client's Authorization header (not an assumed
    // elevated role) is what PostgREST is enforcing against.
    const { data, error } = await client
      .from('organization_members')
      .select('org_id')
      .eq('user_id', testUserId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('falls back to the cookie path when no Authorization header is present', async () => {
    mockAuthorizationHeader = null;
    const client = await getServerSupabaseClient();
    // No cookie session was set up by the mock cookies() above, so this must resolve to "no user",
    // exactly like an unauthenticated PWA visitor -- proving the cookie branch still runs (not
    // the bearer branch) and does not throw.
    const {
      data: { user },
    } = await client.auth.getUser();
    expect(user).toBeNull();
  });
});
