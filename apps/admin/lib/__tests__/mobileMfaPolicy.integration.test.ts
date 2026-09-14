import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The V1 MFA boundary (lib/mfaPolicy.ts) against REAL local Supabase Auth, with real TOTP factors,
// through the real proxy() and the real admin route (2026-09-14). Proves: an account with a verified
// factor can use the Android V1 routes with a password-only (AAL1) bearer token; the same token is
// refused everywhere else until it reaches AAL2; platform administration stays closed to bearer
// tokens at any assurance level.

let mockAuthorizationHeader: string | null = null;
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null,
  }),
  cookies: async () => ({ get: () => undefined, set: () => {}, getAll: () => [] }),
}));

const SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = 'TestPassw0rd!23';

const { proxy } = await import('@/proxy');
const { GET: adminOrganizations } = await import('@/app/api/v1/admin/organizations/route');
const { GET: listInvoices } = await import('@/app/api/v1/invoices/route');

let supabaseReachable = false;
try {
  supabaseReachable = (await fetch(`${SUPABASE_URL}/auth/v1/health`)).ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) -- what an authenticator app computes. */
function totp(base32Secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of base32Secret.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    (((hmac[offset]! & 0x7f) << 24) |
      (hmac[offset + 1]! << 16) |
      (hmac[offset + 2]! << 8) |
      hmac[offset + 3]!) %
    1_000_000;
  return String(code).padStart(6, '0');
}

describeIfSupabase('V1 mobile MFA policy (real local Supabase Auth, real TOTP)', () => {
  const service: SupabaseClient = createClient(
    SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const tokens = { enrolledAal1: '', enrolledAal2: '', plain: '', adminAal1: '', adminAal2: '' };

  const newClient = () =>
    createClient(SUPABASE_URL, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

  async function createUser(label: string) {
    const email = `mfa-policy-${label}-${suffix}@test.propertyvault.example`;
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    userIds.push(data.user!.id);
    return { email, id: data.user!.id };
  }

  async function passwordToken(email: string) {
    const client = newClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw error;
    return { client, token: data.session!.access_token };
  }

  /** Enrolls and verifies a TOTP factor; returns the now-AAL2 access token of that session. */
  async function enrollVerifiedTotp(client: SupabaseClient) {
    const enrolled = await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `vitest-${randomUUID()}`,
    });
    if (enrolled.error) throw enrolled.error;
    const verified = await client.auth.mfa.challengeAndVerify({
      factorId: enrolled.data.id,
      code: totp(enrolled.data.totp.secret),
    });
    if (verified.error) throw verified.error;
    return verified.data.access_token;
  }

  const decodeAal = (jwt: string) =>
    JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()).aal;

  async function throughProxy(method: string, path: string, token: string) {
    const response = await proxy(
      new NextRequest(`http://127.0.0.1:3100${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, host: '127.0.0.1:3100' },
      }),
    );
    const passed = response.headers.get('x-middleware-next') === '1';
    const code = passed
      ? null
      : ((await response.json()) as { error?: { code?: string } }).error?.code;
    return { passed, status: response.status, code };
  }

  beforeAll(async () => {
    const enrolled = await createUser('enrolled');
    const first = await passwordToken(enrolled.email);
    tokens.enrolledAal2 = await enrollVerifiedTotp(first.client);
    tokens.enrolledAal1 = (await passwordToken(enrolled.email)).token; // password only, factor verified

    const plain = await createUser('plain');
    tokens.plain = (await passwordToken(plain.email)).token;

    const admin = await createUser('admin');
    const { error } = await service
      .from('platform_admin_users')
      .insert({
        auth_user_id: admin.id,
        role: 'super_admin',
        display_name: 'MFA policy vitest admin',
      });
    if (error) throw error;
    const adminFirst = await passwordToken(admin.email);
    tokens.adminAal2 = await enrollVerifiedTotp(adminFirst.client);
    tokens.adminAal1 = (await passwordToken(admin.email)).token;

    expect([decodeAal(tokens.enrolledAal1), decodeAal(tokens.enrolledAal2)]).toEqual([
      'aal1',
      'aal2',
    ]);
  }, 120_000);

  afterAll(async () => {
    mockAuthorizationHeader = null;
    await service.from('platform_admin_users').delete().in('auth_user_id', userIds);
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  });

  const ORG = '0f1e2d3c-0000-4000-8000-00000000abcd';
  const INVOICE = '0f1e2d3c-0000-4000-8000-00000000beef';

  it('ordinary Android V1 routes: an MFA-enrolled account passes with a password-only token', async () => {
    for (const [method, path] of [
      ['GET', '/api/v1/invoices'],
      ['GET', `/api/v1/invoices/${INVOICE}`],
      ['GET', `/api/v1/organizations/${ORG}/financial-summary`],
      ['POST', `/api/v1/invoices/${INVOICE}/payments`],
      ['POST', '/api/v1/account/delete'],
    ] as const) {
      expect(
        await throughProxy(method, path, tokens.enrolledAal1),
        `${method} ${path}`,
      ).toMatchObject({ passed: true });
    }
    mockAuthorizationHeader = `Bearer ${tokens.enrolledAal1}`;
    expect((await listInvoices()).status).toBe(200);
  }, 60_000);

  it('any other route: the same AAL1 token is refused with mfa_required -- no accidental bearer bypass', async () => {
    for (const [method, path] of [
      ['PATCH', `/api/v1/invoices/${INVOICE}`],
      ['POST', `/api/v1/invoices/${INVOICE}/void`],
      ['PATCH', `/api/v1/organizations/${ORG}`],
      ['POST', `/api/v1/organizations/${ORG}/staff-provisions`],
      ['GET', '/api/v1/tenants'],
    ] as const) {
      expect(await throughProxy(method, path, tokens.enrolledAal1), `${method} ${path}`).toEqual({
        passed: false,
        status: 403,
        code: 'mfa_required',
      });
    }
  }, 60_000);

  it('the same routes pass once the token is AAL2, and for an account with no factor at all', async () => {
    for (const token of [tokens.enrolledAal2, tokens.plain]) {
      expect(await throughProxy('PATCH', `/api/v1/organizations/${ORG}`, token)).toMatchObject({
        passed: true,
      });
      expect(await throughProxy('GET', '/api/v1/tenants', token)).toMatchObject({ passed: true });
    }
  }, 60_000);

  it('a token Supabase Auth rejects is left to the route (401), never turned into data or mfa_required', async () => {
    expect(
      await throughProxy('PATCH', `/api/v1/organizations/${ORG}`, 'not-a-real-token'),
    ).toMatchObject({ passed: true });
  });

  it('platform administration stays closed to bearer tokens at AAL1 and AAL2 alike (privileged MFA preserved)', async () => {
    for (const token of [tokens.adminAal1, tokens.adminAal2]) {
      expect(await throughProxy('GET', '/api/v1/admin/organizations', token)).toMatchObject({
        passed: true,
      }); // the route decides
      mockAuthorizationHeader = `Bearer ${token}`;
      const response = await adminOrganizations(
        new NextRequest('http://127.0.0.1:3100/api/v1/admin/organizations'),
      );
      expect(response.status, decodeAal(token)).toBe(403);
    }
  }, 60_000);
});
