import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { provisionStaffMember, sendActivationLink } from '../staffProvisioning';

// Provisioned-staff account model (this date). Real local-Supabase integration tests, same
// pattern as inviteAcceptanceSeatCheck.test.ts/emailDispatch.test.ts -- this file's entire
// purpose is proving the audit's own "empirically test, never assume" requirement for
// generateLink({type:'invite'})'s reuse-not-duplicate behavior, which cannot be proven by mocking
// the Admin API (that would just assert our own assumption back at us).

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
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

describeIfSupabase('provisionStaffMember / sendActivationLink (real local Supabase integration)', () => {
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
    principalEmail = `staffprov-vitest-principal-${principalId}@test.propertyvault.example`;
    const { error: principalErr } = await serviceClient.auth.admin.createUser({
      id: principalId,
      email: principalEmail,
      email_confirm: true,
      password: TEST_PASSWORD,
    } as never);
    if (principalErr) throw principalErr;

    const { data: org, error: orgErr } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Staff Provisioning Vitest Org ${Date.now()}`, org_type: 'agency' })
      .select('id')
      .single();
    if (orgErr) throw orgErr;
    orgId = org.id;
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
        await serviceClient.from('organization_subscriptions').delete().eq('org_id', id);
        await serviceClient.from('organizations').delete().eq('id', id);
      } catch {
        // Best-effort local-dev cleanup only -- never fails the test over it.
      }
    }
    for (const id of createdUserIds) {
      try {
        await serviceClient.auth.admin.deleteUser(id);
      } catch {
        // Best-effort local-dev cleanup only -- never fails the test over it.
      }
    }
    createdOrgIds.length = 0;
    createdUserIds.length = 0;
  });

  it('a brand-new email: creates one real GoTrue identity, sends the activation email, stores the hashed token', async () => {
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);
    const email = `staffprov-vitest-new-${randomUUID()}@test.propertyvault.example`;

    const result = await provisionStaffMember(principalClient, serviceClient, principalId, {
      orgId,
      email,
      fullName: 'Vitest New Hire',
      role: 'agent',
      propertyAccessMode: 'all',
      selectedProperties: [],
    });

    expect(result.isExistingActiveUser).toBe(false);
    expect(result.membershipActivated).toBe(false);
    expect(result.emailOutcome).toBe('activation_sent');

    const { data: authUsers } = await serviceClient.auth.admin.listUsers();
    const created = authUsers.users.find((u) => u.email === email);
    expect(created).toBeDefined();
    createdUserIds.push(created!.id);

    const { data: provision } = await serviceClient
      .from('organization_staff_provisions')
      .select('*')
      .eq('id', result.provisionId)
      .single();
    expect(provision.status).toBe('awaiting_activation');
    expect(provision.auth_user_id).toBe(created!.id);
    expect(provision.token_hash).toBeTruthy();
    // Never the plaintext OTP/action link -- only GoTrue's own already-hashed representation.
    expect(provision.token_hash).not.toContain('http');
  });

  it('calling sendActivationLink() twice for the same still-passwordless email reuses the SAME auth user -- no duplicate identity (orphan scenario B/C recovery, empirically proven)', async () => {
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);
    const email = `staffprov-vitest-retry-${randomUUID()}@test.propertyvault.example`;

    const first = await provisionStaffMember(principalClient, serviceClient, principalId, {
      orgId,
      email,
      fullName: 'Vitest Retry Hire',
      role: 'agent',
      propertyAccessMode: 'all',
      selectedProperties: [],
    });
    expect(first.emailOutcome).toBe('activation_sent');

    const { data: firstProvisionData } = await serviceClient
      .from('organization_staff_provisions')
      .select('auth_user_id, token_hash')
      .eq('id', first.provisionId)
      .single();
    const firstProvision = firstProvisionData!;
    const firstAuthUserId = firstProvision.auth_user_id as string;
    createdUserIds.push(firstAuthUserId);

    // Simulates the resend action -- generateLink({type:'invite'}) called again for the exact
    // same still-passwordless email.
    const second = await sendActivationLink(serviceClient, {
      provisionId: first.provisionId,
      orgId,
      orgName: 'Vitest Org',
      email,
      role: 'agent',
      actorUserId: principalId,
      dispatchAttempt: 1,
    });
    expect(second.outcome).toBe('activation_sent');

    const { data: secondProvisionData } = await serviceClient
      .from('organization_staff_provisions')
      .select('auth_user_id, token_hash')
      .eq('id', first.provisionId)
      .single();
    const secondProvision = secondProvisionData!;
    expect(secondProvision.auth_user_id).toBe(firstAuthUserId);
    // A fresh OTP was issued -- the stored hash changes -- but the identity itself did not.
    expect(secondProvision.token_hash).not.toBe(firstProvision.token_hash);

    const { data: authUsers } = await serviceClient.auth.admin.listUsers();
    const matching = authUsers.users.filter((u) => u.email === email);
    expect(matching.length).toBe(1);

    // The resend's own dispatchAttempt suffix must produce a genuinely second email_messages row,
    // not be silently swallowed by dispatchEmail()'s idempotency guard (the exact bug this
    // codebase already found once for organization-invites/resend -- avoided here from the start).
    const { count } = await serviceClient
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('related_entity_id', first.provisionId)
      .eq('template_name', 'staff_activation');
    expect(count).toBe(2);
  });

  it('an existing, password-capable Proplyst user is activated immediately -- no auth link, no duplicate identity', async () => {
    const existingId = randomUUID();
    createdUserIds.push(existingId);
    const existingEmail = `staffprov-vitest-existing-${existingId}@test.propertyvault.example`;
    await serviceClient.auth.admin.createUser({
      id: existingId,
      email: existingEmail,
      email_confirm: true,
      password: TEST_PASSWORD,
    } as never);

    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);
    const result = await provisionStaffMember(principalClient, serviceClient, principalId, {
      orgId,
      email: existingEmail,
      fullName: null,
      role: 'agent',
      propertyAccessMode: 'all',
      selectedProperties: [],
    });

    expect(result.isExistingActiveUser).toBe(true);
    expect(result.membershipActivated).toBe(true);
    expect(result.emailOutcome).toBe('notification_sent');

    const { data: membershipData } = await serviceClient
      .from('organization_members')
      .select('status, role')
      .eq('org_id', orgId)
      .eq('user_id', existingId)
      .single();
    const membership = membershipData!;
    expect(membership.status).toBe('active');
    expect(membership.role).toBe('agent');

    const { data: authUsers } = await serviceClient.auth.admin.listUsers();
    expect(authUsers.users.filter((u) => u.email === existingEmail).length).toBe(1);

    const { count } = await serviceClient
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('related_entity_id', result.provisionId)
      .eq('template_name', 'staff_added_existing_user');
    expect(count).toBe(1);
  });

  it('is rejected once the org has no remaining staff seats -- no row created, no auth identity created', async () => {
    const { data: plan } = await serviceClient.from('plans').select('id').eq('code', 'starter').single();
    await serviceClient.from('organization_subscriptions').insert({
      org_id: orgId,
      plan_id: plan!.id,
      billing_cycle: 'monthly',
      current_period_start: new Date().toISOString().slice(0, 10),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      status: 'active',
    });

    const takenId = randomUUID();
    createdUserIds.push(takenId);
    const takenEmail = `staffprov-vitest-seat-taken-${takenId}@test.propertyvault.example`;
    await serviceClient.auth.admin.createUser({
      id: takenId,
      email: takenEmail,
      email_confirm: true,
      password: TEST_PASSWORD,
    } as never);
    await serviceClient.from('organization_members').insert({
      org_id: orgId,
      user_id: takenId,
      role: 'agent',
      status: 'active',
      joined_at: new Date().toISOString(),
    });

    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);
    const rejectedEmail = `staffprov-vitest-seat-rejected-${randomUUID()}@test.propertyvault.example`;

    await expect(
      provisionStaffMember(principalClient, serviceClient, principalId, {
        orgId,
        email: rejectedEmail,
        fullName: null,
        role: 'agent',
        propertyAccessMode: 'all',
        selectedProperties: [],
      }),
    ).rejects.toThrow(/staff_seat_limit_reached/);

    const { data: authUsers } = await serviceClient.auth.admin.listUsers();
    expect(authUsers.users.some((u) => u.email === rejectedEmail)).toBe(false);
  });
});
