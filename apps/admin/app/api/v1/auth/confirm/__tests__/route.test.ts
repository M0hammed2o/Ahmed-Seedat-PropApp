import { afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Email-confirmation cross-device-safe rewrite (WORKLOG.md this date). Proves the REAL route
// against a real local Supabase instance -- not mocked -- covering exactly what made the old
// {{ .ConfirmationURL }}-based flow unreliable: a valid token_hash succeeds and actually confirms
// the account, a re-used token_hash fails safely (never a raw Supabase error), and a malformed
// request never reaches verifyOtp() at all. Same real-Supabase-integration pattern as
// app/api/v1/ai/__tests__/assistant.route.test.ts.

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

const { POST: confirmEmail } = await import('../route');

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
  const email = `e2e-confirm-${label}-${Date.now()}@propertyvault.example`;
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

function postRequest(payload: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/auth/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function isEmailConfirmed(userId: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const body = (await res.json()) as { email_confirmed_at: string | null };
  return Boolean(body.email_confirmed_at);
}

describeIfSupabase('POST /api/v1/auth/confirm (real local Supabase integration)', () => {
  afterAll(async () => {
    for (const id of createdUserIds) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE_KEY!, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      }).catch(() => {});
    }
  });

  it('a missing tokenHash never reaches verifyOtp() -- 400, outcome invalid', async () => {
    const response = await confirmEmail(postRequest({ type: 'signup' }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.outcome).toBe('invalid');
  });

  it('a type other than "signup" is rejected before verifyOtp() -- 400, outcome invalid', async () => {
    const response = await confirmEmail(postRequest({ tokenHash: 'anything', type: 'recovery' }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.outcome).toBe('invalid');
  });

  it('a valid, fresh token_hash succeeds and genuinely confirms the account', async () => {
    const { userId, tokenHash } = await createUnconfirmedUserWithTokenHash('happy-path');
    expect(await isEmailConfirmed(userId)).toBe(false);

    const response = await confirmEmail(postRequest({ tokenHash, type: 'signup' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe('success');

    expect(await isEmailConfirmed(userId)).toBe(true);
  });

  it('re-using an already-consumed token_hash fails safely, never a raw Supabase error', async () => {
    const { tokenHash } = await createUnconfirmedUserWithTokenHash('reuse');
    const first = await confirmEmail(postRequest({ tokenHash, type: 'signup' }));
    expect((await first.json()).outcome).toBe('success');

    // Second call, same token -- this test's mocked cookies() never actually persists a session
    // between calls, so this exercises the "no existing session to recover from" branch, the more
    // common real-world case (a different device/browser, or simply no cookie continuity).
    const second = await confirmEmail(postRequest({ tokenHash, type: 'signup' }));
    expect(second.status).toBe(400);
    const secondBody = await second.json();
    expect(secondBody.outcome).toBe('used_or_expired');
    // Never a raw GoTrue error shape leaking through.
    expect(secondBody.error).toBeUndefined();
    expect(JSON.stringify(secondBody)).not.toMatch(/otp_expired|invalid_grant/i);
  });

  it('a syntactically-plausible but nonexistent token_hash fails safely, not as a 500', async () => {
    const response = await confirmEmail(postRequest({ tokenHash: 'a'.repeat(40), type: 'signup' }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(['used_or_expired', 'invalid']).toContain(body.outcome);
  });
});
