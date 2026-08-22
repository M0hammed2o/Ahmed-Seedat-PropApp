import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Staff invitation flow audit (this date): the ONE thing pgTAP can't prove inside a single
// transaction -- two genuinely concurrent acceptances racing for the SAME org's last seat. Each
// `.rpc()` call below runs through PostgREST as its own real, separate connection/transaction, so
// `Promise.all([...])` here is a real concurrency test, not a simulated one. Complements
// supabase/tests/invite_acceptance_seat_check.test.sql, which covers the non-concurrent shape of
// the same fix (reject-without-partial-state, unlimited-org regression, principal exclusion).

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

describeIfSupabase('accept_organization_invite() seat check (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let principalId: string;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  beforeEach(async () => {
    principalId = randomUUID();
    createdUserIds.push(principalId);
    const { error: principalErr } = await serviceClient.auth.admin.createUser({
      id: principalId,
      email: `seat-race-principal-${principalId}@test.propertyvault.example`,
      email_confirm: true,
      password: TEST_PASSWORD,
    } as never);
    if (principalErr) throw principalErr;

    const { data: org, error: orgErr } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Seat Race Org ${Date.now()}`, org_type: 'agency', status: 'trial' })
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

    const { data: plan } = await serviceClient
      .from('plans')
      .select('id')
      .eq('code', 'starter')
      .single();
    await serviceClient.from('organization_subscriptions').insert({
      org_id: orgId,
      plan_id: plan!.id,
      billing_cycle: 'monthly',
      current_period_start: new Date().toISOString().slice(0, 10),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      status: 'active',
    });
  });

  afterEach(async () => {
    for (const id of createdOrgIds) {
      try {
        await serviceClient.from('organization_invites').delete().eq('org_id', id);
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

  it('two concurrent acceptances for the SAME org with exactly one remaining seat: exactly one succeeds, one is rejected, no over-allocation', async () => {
    const invitee1Id = randomUUID();
    const invitee2Id = randomUUID();
    createdUserIds.push(invitee1Id, invitee2Id);
    const email1 = `seat-race-invitee1-${invitee1Id}@test.propertyvault.example`;
    const email2 = `seat-race-invitee2-${invitee2Id}@test.propertyvault.example`;

    await serviceClient.auth.admin.createUser({
      id: invitee1Id,
      email: email1,
      email_confirm: true,
      password: TEST_PASSWORD,
    } as never);
    await serviceClient.auth.admin.createUser({
      id: invitee2Id,
      email: email2,
      email_confirm: true,
      password: TEST_PASSWORD,
    } as never);

    const token1 = randomUUID();
    const token2 = randomUUID();
    await serviceClient.from('organization_invites').insert([
      {
        org_id: orgId,
        email: email1,
        role: 'agent',
        invited_by: principalId,
        token: token1,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        org_id: orgId,
        email: email2,
        role: 'agent',
        invited_by: principalId,
        token: token2,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);

    const [client1, client2] = await Promise.all([
      signedInClient(email1, TEST_PASSWORD),
      signedInClient(email2, TEST_PASSWORD),
    ]);

    // Real concurrency: both requests fire together, each its own connection via PostgREST.
    const [result1, result2] = await Promise.allSettled([
      client1.rpc('accept_organization_invite', { p_token: token1 }),
      client2.rpc('accept_organization_invite', { p_token: token2 }),
    ]);

    const outcomes = [result1, result2].map((r) => {
      if (r.status === 'rejected') return { ok: false as const };
      return { ok: !r.value.error, error: r.value.error?.message };
    });

    const succeeded = outcomes.filter((o) => o.ok);
    const failed = outcomes.filter((o) => !o.ok);

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(failed[0]!.error ?? '').toMatch(/staff_seat_limit_reached/);

    // The org's own seat count is the ground truth -- must be exactly 1, never 2, regardless of
    // which of the two invitees happened to win the race.
    const { data: members } = await serviceClient
      .from('organization_members')
      .select('user_id, role, status')
      .eq('org_id', orgId)
      .neq('role', 'principal')
      .eq('status', 'active');
    expect(members?.length).toBe(1);

    // The loser's invitation must remain untouched -- not accepted, still usable once a seat frees.
    const { data: invites } = await serviceClient
      .from('organization_invites')
      .select('email, accepted_at')
      .eq('org_id', orgId)
      .order('created_at');
    const acceptedEmails = invites?.filter((i) => i.accepted_at !== null).map((i) => i.email);
    const pendingEmails = invites?.filter((i) => i.accepted_at === null).map((i) => i.email);
    expect(acceptedEmails?.length).toBe(1);
    expect(pendingEmails?.length).toBe(1);
  });
});
