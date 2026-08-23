import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Provisioned-staff account model, predeploy hardening pass (this date). Proves the EXISTING,
// unmodified forgot-password/recovery flow keeps working for a freshly-activated staff account --
// no staff-specific password-reset mechanism was built, per the task's own explicit instruction,
// so this is purely a regression/compatibility proof, not new product behaviour.

let mockAuthorizationHeader: string | null = null;

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null,
  }),
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

const { POST: postPasswordReset } = await import('../route');
const { provisionStaffMember } = await import('@/lib/staffProvisioning');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TEST_PASSWORD = 'TestPassw0rd!23';

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

async function signedInClient(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function passwordGrantSucceeds(email: string, password: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return Boolean(body.access_token);
}

describeIfSupabase(
  'forgot-password recovery flow after staff activation (real local Supabase integration)',
  () => {
    const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let orgId: string;
    let principalId: string;
    let principalEmail: string;
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];

    beforeEach(async () => {
      mockAuthorizationHeader = null;
      principalId = randomUUID();
      createdUserIds.push(principalId);
      principalEmail = `pwreset-principal-${principalId}@test.propertyvault.example`;
      await serviceClient.auth.admin.createUser({
        id: principalId,
        email: principalEmail,
        email_confirm: true,
        password: TEST_PASSWORD,
      } as never);

      const { data: org } = await serviceClient
        .from('organizations')
        .insert({ legal_name: `Password Reset Vitest Org ${Date.now()}`, org_type: 'agency' })
        .select('id')
        .single();
      orgId = org!.id;
      createdOrgIds.push(orgId);

      await serviceClient.from('organization_members').insert({
        org_id: orgId,
        user_id: principalId,
        role: 'principal',
        status: 'active',
        joined_at: new Date().toISOString(),
      });
    });

    afterEach(async () => {
      for (const id of createdOrgIds) {
        try {
          await serviceClient.from('organization_staff_provisions').delete().eq('org_id', id);
          await serviceClient.from('organization_members').delete().eq('org_id', id);
          await serviceClient.from('organizations').delete().eq('id', id);
        } catch {
          // Best-effort local-dev cleanup only.
        }
      }
      for (const id of createdUserIds) {
        try {
          await serviceClient.auth.admin.deleteUser(id);
        } catch {
          // Best-effort local-dev cleanup only.
        }
      }
      createdOrgIds.length = 0;
      createdUserIds.length = 0;
    });

    it('a freshly-activated staff account can reset its password through the existing forgot-password flow, with membership/role/property access untouched and no staff-specific mechanism involved', async () => {
      const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);
      const employeeEmail = `pwreset-employee-${randomUUID()}@test.propertyvault.example`;
      const firstPassword = 'EmployeeFirstPassw0rd!1';
      const secondPassword = 'EmployeeSecondPassw0rd!2';

      // Full real activation flow: generateLink(invite) -> verifyOtp -> set password ->
      // activate_staff_provision().
      const provisionResult = await provisionStaffMember(
        principalClient,
        serviceClient,
        principalId,
        {
          orgId,
          email: employeeEmail,
          fullName: 'Password Reset Employee',
          role: 'agent',
          propertyAccessMode: 'all',
          selectedProperties: [],
        },
      );
      const { data: provision } = await serviceClient
        .from('organization_staff_provisions')
        .select('auth_user_id, token_hash')
        .eq('id', provisionResult.provisionId)
        .single();
      const employeeId = provision!.auth_user_id as string;
      createdUserIds.push(employeeId);

      const activationClient = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false },
      });
      const { error: verifyError } = await activationClient.auth.verifyOtp({
        token_hash: provision!.token_hash as string,
        type: 'invite',
      });
      expect(verifyError).toBeNull();
      const { error: setPasswordError } = await activationClient.auth.updateUser({
        password: firstPassword,
      });
      expect(setPasswordError).toBeNull();
      const { error: activateError } = await activationClient.rpc('activate_staff_provision');
      expect(activateError).toBeNull();

      const { data: membershipBeforeReset } = await serviceClient
        .from('organization_members')
        .select('role, status, property_access_mode')
        .eq('org_id', orgId)
        .eq('user_id', employeeId)
        .single();
      expect(membershipBeforeReset!.status).toBe('active');

      // The employee's own password genuinely works before any reset.
      expect(await passwordGrantSucceeds(employeeEmail, firstPassword)).toBe(true);

      // Step 1: the REAL, unmodified forgot-password route -- always 200, regardless of whether
      // the recovery email actually gets consumed in this test (anti-enumeration behaviour,
      // unchanged by this feature).
      const resetRequest = new NextRequest('http://localhost/api/v1/auth/password-reset', {
        method: 'POST',
        body: JSON.stringify({ email: employeeEmail }),
        headers: { 'Content-Type': 'application/json' },
      });
      const resetResponse = await postPasswordReset(resetRequest);
      expect(resetResponse.status).toBe(200);
      const resetBody = await resetResponse.json();
      expect(resetBody.sent).toBe(true);

      // Step 2: a real, consumable recovery token -- same generateLink() technique already
      // established this session for the invite flow, used here for 'recovery' instead, avoiding
      // fragile Mailpit-inbox parsing while still proving a REAL GoTrue-issued token round-trips
      // correctly (this is exactly the mechanism ForgotPasswordForm/ResetPasswordForm.tsx's own
      // real `resetPasswordForEmail`/`updateUser` calls rely on -- no shortcut taken on the parts
      // that matter: verifyOtp + updateUser are both real calls against the real GoTrue instance).
      const { data: recoveryLink, error: recoveryLinkError } =
        await serviceClient.auth.admin.generateLink({ type: 'recovery', email: employeeEmail });
      expect(recoveryLinkError).toBeNull();

      const recoveryClient = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false },
      });
      const { error: recoveryVerifyError } = await recoveryClient.auth.verifyOtp({
        token_hash: recoveryLink!.properties!.hashed_token,
        type: 'recovery',
      });
      expect(recoveryVerifyError).toBeNull();
      const { error: recoveryUpdateError } = await recoveryClient.auth.updateUser({
        password: secondPassword,
      });
      expect(recoveryUpdateError).toBeNull();

      // Old password is invalidated; new password works.
      expect(await passwordGrantSucceeds(employeeEmail, firstPassword)).toBe(false);
      expect(await passwordGrantSucceeds(employeeEmail, secondPassword)).toBe(true);

      // Organisation membership/role/property access are completely untouched by the password
      // reset -- this is auth-layer only, never touches organization_members.
      const { data: membershipAfterReset } = await serviceClient
        .from('organization_members')
        .select('role, status, property_access_mode')
        .eq('org_id', orgId)
        .eq('user_id', employeeId)
        .single();
      expect(membershipAfterReset).toEqual(membershipBeforeReset);

      // No new organisation or subscription was created for the employee as a side effect of any
      // of this -- they still own nothing, only the one pre-existing org's membership.
      const { count: orgsOwnedByEmployee } = await serviceClient
        .from('organization_members')
        .select('org_id', { count: 'exact', head: true })
        .eq('user_id', employeeId)
        .eq('role', 'principal');
      expect(orgsOwnedByEmployee).toBe(0);
      const { count: subscriptionCount } = await serviceClient
        .from('organization_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId);
      expect(subscriptionCount).toBe(0);

      // No staff-specific password store exists -- confirmed structurally: the provisions row
      // itself never held a plaintext/derived password of any kind, only the (now-consumed)
      // activation token hash, and this whole reset flow never touched that table at all.
      const { data: provisionRowUnaffected } = await serviceClient
        .from('organization_staff_provisions')
        .select('status')
        .eq('id', provisionResult.provisionId)
        .single();
      expect(provisionRowUnaffected!.status).toBe('activated');
    }, 20000);
  },
);
