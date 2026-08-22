import { afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Apple login verification gate (this date): /auth/callback is the SAME single landing point for
// every redirect-based auth flow -- Google/Apple OAuth's `?code=...` and the email token_hash
// path both fall through to the identical "resolve next -> redirect" tail once the exchange
// succeeds (route.ts's own comment). A real OAuth provider round trip can't be simulated here, but
// verifyOtp()'s token_hash path exercises that EXACT shared tail against a real local Supabase
// instance -- not mocked -- proving the actual redirect Location header the route generates,
// including the open-redirect protection (safeNextPathOr) an OAuth `code` success would hit too.

vi.mock('next/headers', () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    getAll: () => [],
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const { GET: authCallback } = await import('../route');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

const createdUserIds: string[] = [];

async function createUnconfirmedUserWithTokenHash(
  label: string,
): Promise<{ userId: string; email: string; tokenHash: string }> {
  const email = `e2e-callback-${label}-${Date.now()}@propertyvault.example`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'signup', email, password: 'TestPassw0rd!23' }),
  });
  const body = (await res.json()) as { id: string; hashed_token: string };
  createdUserIds.push(body.id);
  return { userId: body.id, email, tokenHash: body.hashed_token };
}

function callbackRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/auth/callback${query}`);
}

describeIfSupabase('GET /auth/callback (real local Supabase integration)', () => {
  afterAll(async () => {
    for (const id of createdUserIds) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      }).catch(() => {});
    }
  });

  it('no code/token_hash/error params at all -- redirects to /login, never a dead end', async () => {
    const response = await authCallback(callbackRequest(''));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/login');
  });

  it('a provider-supplied error with no existing session -- redirects to /login?error=..., never leaks the raw error code', async () => {
    const response = await authCallback(
      callbackRequest('?error=access_denied&error_description=User+cancelled'),
    );
    expect(response.status).toBe(307);
    const location = response.headers.get('location')!;
    expect(location.startsWith('http://localhost:3000/login?error=')).toBe(true);
  });

  it('a valid token_hash succeeds and redirects to the default next (/), exercising the SAME shared tail an OAuth code success would', async () => {
    const { tokenHash } = await createUnconfirmedUserWithTokenHash('happy-path');
    const response = await authCallback(callbackRequest(`?token_hash=${tokenHash}&type=signup`));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/');
  });

  it('preserves ?next= end-to-end for invitation continuation', async () => {
    const { tokenHash } = await createUnconfirmedUserWithTokenHash('next-preserved');
    const nextPath = '/invitations/accept?token=abc123';
    const response = await authCallback(
      callbackRequest(`?token_hash=${tokenHash}&type=signup&next=${encodeURIComponent(nextPath)}`),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`http://localhost:3000${nextPath}`);
  });

  it('open-redirect protection: an absolute-URL ?next= is neutralized, never followed to an attacker origin', async () => {
    const { tokenHash } = await createUnconfirmedUserWithTokenHash('open-redirect');
    const response = await authCallback(
      callbackRequest(
        `?token_hash=${tokenHash}&type=signup&next=${encodeURIComponent('https://evil.example/steal')}`,
      ),
    );
    expect(response.status).toBe(307);
    const location = response.headers.get('location')!;
    expect(location.startsWith('http://localhost:3000/')).toBe(true);
    expect(location).not.toContain('evil.example');
  });

  it('a re-used/invalid token_hash fails safely -- redirects to /login?error=..., not a 500 or raw Supabase error', async () => {
    const { tokenHash } = await createUnconfirmedUserWithTokenHash('reuse');
    await authCallback(callbackRequest(`?token_hash=${tokenHash}&type=signup`));

    const second = await authCallback(callbackRequest(`?token_hash=${tokenHash}&type=signup`));
    expect(second.status).toBe(307);
    const location = second.headers.get('location')!;
    expect(location.startsWith('http://localhost:3000/login?error=')).toBe(true);
    expect(location).not.toMatch(/otp_expired|invalid_grant/i);
  });
});
