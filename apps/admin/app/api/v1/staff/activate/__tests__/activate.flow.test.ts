import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { provisionStaffMember } from '@/lib/staffProvisioning';

// Provisioned-staff account model (this date). Proves the FULL activation chain end-to-end
// against real local Supabase -- generateLink({type:'invite'}) -> verifyOtp(token_hash) ->
// updateUser(password) -> activate_staff_provision() -- exactly the sequence
// POST /api/v1/staff/activate and POST /api/v1/staff/activate/finish perform, minus the Next.js
// route/cookie plumbing itself (which is thin and already typechecked). This is the empirical
// proof the audit's own "never assume Supabase/GoTrue behaviour" requirement called for: that a
// `hashed_token` returned by generateLink() really is consumable by verifyOtp({type:'invite'}),
// and that the resulting session really can call updateUser({password}) and then the RPC.

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const TEST_PASSWORD = 'TestPassw0rd!23';
const NEW_PASSWORD = 'BrandNewPassw0rd!45';

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

describeIfSupabase('staff activation flow (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let principalId: string;
  let principalEmail: string;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  beforeEach(async () => {
    principalId = randomUUID();
    createdUserIds.push(principalId);
    principalEmail = `staffactivate-vitest-principal-${principalId}@test.propertyvault.example`;
    await serviceClient.auth.admin.createUser({
      id: principalId,
      email: principalEmail,
      email_confirm: true,
      password: TEST_PASSWORD,
    } as never);

    const { data: org } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Staff Activation Vitest Org ${Date.now()}`, org_type: 'agency' })
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

  it('a real hashed_token from generateLink() is consumable by verifyOtp(type: invite), and the resulting session can set a password and activate its own provision', async () => {
    // Chains ~8 real network round-trips (provision -> generateLink -> verifyOtp -> updateUser ->
    // RPC -> re-sign-in) -- the default 5s test timeout is tight enough that this occasionally
    // trips under full-suite parallel load even though it's comfortably fast in isolation
    // (confirmed: this exact test passed standalone in ~2s). 20s gives real headroom without
    // masking a genuine hang.
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);
    const email = `staffactivate-vitest-hire-${randomUUID()}@test.propertyvault.example`;

    const result = await provisionStaffMember(principalClient, serviceClient, principalId, {
      orgId,
      email,
      fullName: 'Vitest Activation Hire',
      role: 'agent',
      propertyAccessMode: 'all',
      selectedProperties: [],
    });
    expect(result.emailOutcome).toBe('activation_sent');

    const { data: provisionData } = await serviceClient
      .from('organization_staff_provisions')
      .select('auth_user_id, token_hash')
      .eq('id', result.provisionId)
      .single();
    const provision = provisionData!;
    createdUserIds.push(provision.auth_user_id as string);
    expect(provision.token_hash).toBeTruthy();

    // The employee's own browser: an anonymous client verifying the real token_hash GoTrue issued.
    const employeeClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: verifyData, error: verifyError } = await employeeClient.auth.verifyOtp({
      token_hash: provision.token_hash as string,
      type: 'invite',
    });
    expect(verifyError).toBeNull();
    expect(verifyData.session).toBeTruthy();
    expect(verifyData.user?.id).toBe(provision.auth_user_id);

    const { error: updateError } = await employeeClient.auth.updateUser({ password: NEW_PASSWORD });
    expect(updateError).toBeNull();

    const { data: rpcResult, error: rpcError } = await employeeClient.rpc('activate_staff_provision');
    expect(rpcError).toBeNull();
    expect(rpcResult).toBe(orgId);

    const { data: membershipData } = await serviceClient
      .from('organization_members')
      .select('status, role')
      .eq('org_id', orgId)
      .eq('user_id', provision.auth_user_id)
      .single();
    const membership = membershipData!;
    expect(membership.status).toBe('active');
    expect(membership.role).toBe('agent');

    // The password genuinely took effect -- a fresh sign-in with the NEW password succeeds.
    const reSignedIn = await signedInClient(email, NEW_PASSWORD);
    const { data: whoami } = await reSignedIn.auth.getUser();
    expect(whoami.user?.id).toBe(provision.auth_user_id);
  }, 20000);

  it('a second verifyOtp() with the SAME already-consumed token_hash fails -- single-use, matching the API route\'s own retry-without-token design', async () => {
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);
    const email = `staffactivate-vitest-singleuse-${randomUUID()}@test.propertyvault.example`;

    const result = await provisionStaffMember(principalClient, serviceClient, principalId, {
      orgId,
      email,
      fullName: null,
      role: 'agent',
      propertyAccessMode: 'all',
      selectedProperties: [],
    });
    const { data: provisionData } = await serviceClient
      .from('organization_staff_provisions')
      .select('auth_user_id, token_hash')
      .eq('id', result.provisionId)
      .single();
    const provision = provisionData!;
    createdUserIds.push(provision.auth_user_id as string);

    const client1 = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const client2 = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

    const first = await client1.auth.verifyOtp({
      token_hash: provision.token_hash as string,
      type: 'invite',
    });
    expect(first.error).toBeNull();

    const second = await client2.auth.verifyOtp({
      token_hash: provision.token_hash as string,
      type: 'invite',
    });
    expect(second.error).not.toBeNull();
  });
});
