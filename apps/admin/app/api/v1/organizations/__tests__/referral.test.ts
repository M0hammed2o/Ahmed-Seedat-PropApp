import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Referral attribution (V1 launch-completion pass, WORKLOG.md this date): POST
// /api/v1/organizations optionally accepts referralCode/referrerName and, after
// create_organization() has already committed, attempts a best-effort
// organization_referral_attributions insert via the service-role client (attributeReferralBestEffort()
// in ../route.ts). Proves: a valid code resolves to the right partner; no code is a complete
// no-op (no row, no error); an invalid/unknown code NEVER blocks org creation; a retried write for
// the same org cannot duplicate or overwrite an already-set attribution.

let mockAuthorizationHeader: string | null = null;
const mockCookieJar = new Map<string, string>();

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => (name.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null),
  }),
  cookies: async () => ({
    get: (name: string) => (mockCookieJar.has(name) ? { value: mockCookieJar.get(name) } : undefined),
    set: (name: string, value: string) => {
      mockCookieJar.set(name, value);
    },
    getAll: () => [],
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const { POST } = await import('../route');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

async function adminFetch(path: string, body: unknown, method = 'POST') {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

function orgCreateRequest(body: unknown) {
  return new NextRequest('http://localhost/api/v1/organizations', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describeIfSupabase(
  'POST /api/v1/organizations referral attribution (real local Supabase integration)',
  () => {
    const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let createdUserIds: string[] = [];
    let createdOrgIds: string[] = [];
    let partnerId: string;
    let partnerCode: string;

    beforeEach(async () => {
      mockCookieJar.clear();
      createdUserIds = [];
      createdOrgIds = [];

      const code = `refvitest${Date.now()}`;
      const { data: partner } = await serviceClient
        .from('referral_partners')
        .insert({ name: 'Referral Vitest Partner', referral_code: code })
        .select('id, referral_code')
        .single();
      partnerId = partner!.id;
      partnerCode = partner!.referral_code;
    });

    afterEach(async () => {
      mockAuthorizationHeader = null;
      for (const orgId of createdOrgIds) {
        await serviceClient.from('organization_referral_attributions').delete().eq('org_id', orgId);
        await serviceClient.from('organizations').delete().eq('id', orgId);
      }
      await serviceClient.from('referral_partners').delete().eq('id', partnerId);
      for (const userId of createdUserIds) {
        await serviceClient.auth.admin.deleteUser(userId);
      }
    });

    async function signUpAndAuthenticate(): Promise<void> {
      const email = `referral-signup-${Date.now()}-${Math.random().toString(36).slice(2)}@propertyvault.example`;
      const password = 'TestPassw0rd!23';
      const created = await adminFetch('/auth/v1/admin/users', { email, password, email_confirm: true });
      createdUserIds.push(created.id);

      const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const tokenBody = await tokenRes.json();
      mockAuthorizationHeader = `Bearer ${tokenBody.access_token}`;
    }

    it('signup with a valid referral code attributes correctly (case-insensitive)', async () => {
      await signUpAndAuthenticate();
      const response = await POST(
        orgCreateRequest({
          legalName: `Referral Org Valid ${Date.now()}`,
          orgType: 'owner_managed',
          referralCode: partnerCode.toUpperCase(),
        }),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      createdOrgIds.push(body.id);

      const { data: attribution } = await serviceClient
        .from('organization_referral_attributions')
        .select('referral_partner_id, referral_code_used, fallback_referrer_name')
        .eq('org_id', body.id)
        .single();
      expect(attribution!.referral_partner_id).toBe(partnerId);
      expect(attribution!.referral_code_used).toBe(partnerCode);
      expect(attribution!.fallback_referrer_name).toBeNull();
    });

    it('signup with no referral code and no referrer name works normally -- no attribution row, no error', async () => {
      await signUpAndAuthenticate();
      const response = await POST(
        orgCreateRequest({ legalName: `Referral Org None ${Date.now()}`, orgType: 'owner_managed' }),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      createdOrgIds.push(body.id);

      const { data: attribution } = await serviceClient
        .from('organization_referral_attributions')
        .select('org_id')
        .eq('org_id', body.id)
        .maybeSingle();
      expect(attribution).toBeNull();
    });

    it('signup with an invalid/unknown referral code still succeeds -- org created, attribution row has a null partner', async () => {
      await signUpAndAuthenticate();
      const response = await POST(
        orgCreateRequest({
          legalName: `Referral Org Invalid ${Date.now()}`,
          orgType: 'owner_managed',
          referralCode: 'totally-unknown-code',
        }),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      createdOrgIds.push(body.id);

      const { data: attribution } = await serviceClient
        .from('organization_referral_attributions')
        .select('referral_partner_id, referral_code_used, fallback_referrer_name')
        .eq('org_id', body.id)
        .single();
      expect(attribution!.referral_partner_id).toBeNull();
      expect(attribution!.referral_code_used).toBe('totally-unknown-code');
    });

    it('signup with an unknown code but a fallback referrer name records the fallback name', async () => {
      await signUpAndAuthenticate();
      const response = await POST(
        orgCreateRequest({
          legalName: `Referral Org Fallback ${Date.now()}`,
          orgType: 'owner_managed',
          referrerName: 'Some Friend',
        }),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      createdOrgIds.push(body.id);

      const { data: attribution } = await serviceClient
        .from('organization_referral_attributions')
        .select('referral_partner_id, fallback_referrer_name')
        .eq('org_id', body.id)
        .single();
      expect(attribution!.referral_partner_id).toBeNull();
      expect(attribution!.fallback_referrer_name).toBe('Some Friend');
    });

    it('a retried write for the same org cannot duplicate or overwrite an already-set attribution', async () => {
      await signUpAndAuthenticate();
      const response = await POST(
        orgCreateRequest({
          legalName: `Referral Org Retry ${Date.now()}`,
          orgType: 'owner_managed',
          referralCode: partnerCode,
        }),
      );
      const body = await response.json();
      createdOrgIds.push(body.id);

      // Simulates exactly what attributeReferralBestEffort() does on a retried request for the
      // same org -- ON CONFLICT (org_id) DO NOTHING must make this a silent no-op.
      const { error } = await serviceClient.from('organization_referral_attributions').upsert(
        {
          org_id: body.id,
          referral_partner_id: null,
          referral_code_used: null,
          fallback_referrer_name: 'Should Not Apply',
        },
        { onConflict: 'org_id', ignoreDuplicates: true },
      );
      expect(error).toBeNull();

      const { data: attribution } = await serviceClient
        .from('organization_referral_attributions')
        .select('referral_partner_id, fallback_referrer_name')
        .eq('org_id', body.id)
        .single();
      expect(attribution!.referral_partner_id).toBe(partnerId);
      expect(attribution!.fallback_referrer_name).toBeNull();
    });
  },
);
