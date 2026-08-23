import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { provisionStaffMember } from '../staffProvisioning';

// Provisioned-staff account model, predeploy hardening pass (this date). The ONE thing pgTAP
// can't prove inside a single transaction -- two genuinely concurrent activate_staff_provision()
// calls racing for the SAME org's last seat. Each `.rpc()` call below runs through PostgREST as
// its own real, separate connection/transaction, so `Promise.allSettled([...])` here is a real
// concurrency test, not a simulated one. Mirrors inviteAcceptanceSeatCheck.test.ts's own proven
// pattern for accept_organization_invite() exactly, applied to activate_staff_provision()'s
// equivalent org-row lock (migration 20260101000124).

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

describeIfSupabase(
  'activate_staff_provision() final-seat race (real local Supabase integration, two genuine connections)',
  () => {
    const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let orgId: string;
    let principalId: string;
    let principalEmail: string;
    let propertyId: string;
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];

    beforeEach(async () => {
      principalId = randomUUID();
      createdUserIds.push(principalId);
      principalEmail = `seatrace-principal-${principalId}@test.propertyvault.example`;
      await serviceClient.auth.admin.createUser({
        id: principalId,
        email: principalEmail,
        email_confirm: true,
        password: TEST_PASSWORD,
      } as never);

      const { data: org } = await serviceClient
        .from('organizations')
        .insert({ legal_name: `Seat Race Org ${Date.now()}`, org_type: 'agency' })
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

      // Seat-limited org: starter plan, maxStaff = 1 -- exactly one seat for two racing hires.
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

      const { data: property } = await serviceClient
        .from('properties')
        .insert({
          org_id: orgId,
          nickname: 'Seat Race Unit',
          address_line1: '1 Race St',
          city: 'Cape Town',
          country: 'ZA',
          property_type: 'house',
        })
        .select('id')
        .single();
      propertyId = property!.id;
    });

    afterEach(async () => {
      for (const id of createdOrgIds) {
        try {
          await serviceClient.from('organization_staff_provisions').delete().eq('org_id', id);
          await serviceClient.from('organization_members').delete().eq('org_id', id);
          await serviceClient.from('organization_subscriptions').delete().eq('org_id', id);
          await serviceClient.from('properties').delete().eq('org_id', id);
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

    it('two concurrent activations for the org\'s one remaining seat: exactly one wins, one loses with staff_seat_limit_reached, no over-allocation, no partial property_access', async () => {
      const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);

      const email1 = `seatrace-hire1-${randomUUID()}@test.propertyvault.example`;
      const email2 = `seatrace-hire2-${randomUUID()}@test.propertyvault.example`;

      // Deliberately does NOT pre-create these auth users via admin.createUser() -- empirically
      // confirmed (docker exec against local Postgres) that GoTrue's admin.createUser() generates
      // a REAL random password even when none is supplied, which would silently flip
      // provision_staff_member() onto its existing-password-user branch (immediate activation,
      // seat consumed at PROVISIONING time, never reaching the activate_staff_provision() race
      // this test exists to prove) instead of the genuinely-new-email branch. Letting
      // provisionStaffMember() itself create the identity via generateLink({type:'invite'}) is
      // the only way to get a real, genuinely passwordless auth.users row, matching what a real
      // brand-new hire's identity actually looks like. Provisioned with SELECTED property access
      // so a partial-property_access failure would be observable.
      const result1 = await provisionStaffMember(principalClient, serviceClient, principalId, {
        orgId,
        email: email1,
        fullName: 'Seat Race Hire One',
        role: 'agent',
        propertyAccessMode: 'selected',
        selectedProperties: [{ propertyId, propertyRole: 'read_only' }],
      });
      const result2 = await provisionStaffMember(principalClient, serviceClient, principalId, {
        orgId,
        email: email2,
        fullName: 'Seat Race Hire Two',
        role: 'agent',
        propertyAccessMode: 'selected',
        selectedProperties: [{ propertyId, propertyRole: 'read_only' }],
      });
      expect(result1.isExistingActiveUser).toBe(false);
      expect(result2.isExistingActiveUser).toBe(false);
      expect(result1.emailOutcome).toBe('activation_sent');
      expect(result2.emailOutcome).toBe('activation_sent');

      const { data: provisionRow1 } = await serviceClient
        .from('organization_staff_provisions')
        .select('auth_user_id')
        .eq('id', result1.provisionId)
        .single();
      const { data: provisionRow2 } = await serviceClient
        .from('organization_staff_provisions')
        .select('auth_user_id')
        .eq('id', result2.provisionId)
        .single();
      const hire1Id = provisionRow1!.auth_user_id as string;
      const hire2Id = provisionRow2!.auth_user_id as string;
      createdUserIds.push(hire1Id, hire2Id);

      // Neither activation has consumed the seat yet -- both are merely awaiting_activation.
      const { data: preRaceCount } = await serviceClient.rpc('org_active_billable_staff_count', {
        p_org_id: orgId,
      });
      expect(preRaceCount).toBe(0);

      // Each employee's own real session, established via the SAME verifyOtp(type:'invite') path
      // a real browser uses -- not a shortcut, the actual consumable token generateLink() issued.
      const { data: provision1 } = await serviceClient
        .from('organization_staff_provisions')
        .select('token_hash')
        .eq('id', result1.provisionId)
        .single();
      const { data: provision2 } = await serviceClient
        .from('organization_staff_provisions')
        .select('token_hash')
        .eq('id', result2.provisionId)
        .single();

      const anon1 = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const anon2 = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const [verify1, verify2] = await Promise.all([
        anon1.auth.verifyOtp({ token_hash: provision1!.token_hash as string, type: 'invite' }),
        anon2.auth.verifyOtp({ token_hash: provision2!.token_hash as string, type: 'invite' }),
      ]);
      expect(verify1.error).toBeNull();
      expect(verify2.error).toBeNull();

      // The genuine race: both employees call activate_staff_provision() at the same instant,
      // each its own real PostgREST connection/transaction.
      const [outcome1, outcome2] = await Promise.allSettled([
        anon1.rpc('activate_staff_provision'),
        anon2.rpc('activate_staff_provision'),
      ]);

      const results = [outcome1, outcome2].map((r) => {
        if (r.status === 'rejected') return { ok: false as const, error: String(r.reason) };
        return { ok: !r.value.error, error: r.value.error?.message };
      });
      const succeeded = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);

      expect(succeeded.length).toBe(1);
      expect(failed.length).toBe(1);
      expect(failed[0]!.error ?? '').toMatch(/staff_seat_limit_reached/);

      // Ground truth: exactly one seat consumed, never two.
      const { data: postRaceCount } = await serviceClient.rpc('org_active_billable_staff_count', {
        p_org_id: orgId,
      });
      expect(postRaceCount).toBe(1);

      const { data: activeMembers } = await serviceClient
        .from('organization_members')
        .select('user_id')
        .eq('org_id', orgId)
        .neq('role', 'principal')
        .eq('status', 'active');
      expect(activeMembers?.length).toBe(1);

      // No duplicate/partial membership for the loser.
      const { data: allMembersForHires } = await serviceClient
        .from('organization_members')
        .select('user_id, status')
        .eq('org_id', orgId)
        .in('user_id', [hire1Id, hire2Id]);
      expect(allMembersForHires?.length).toBe(1);

      // No partial property_access -- exactly one row (the winner's), never two, never zero.
      const { data: grants } = await serviceClient
        .from('property_access')
        .select('user_id')
        .eq('property_id', propertyId)
        .in('user_id', [hire1Id, hire2Id]);
      expect(grants?.length).toBe(1);
      expect(grants?.[0]?.user_id).toBe(activeMembers?.[0]?.user_id);

      // The loser's own provisions row remains untouched -- still awaiting_activation, safe to
      // retry later once a seat frees up, never silently marked activated.
      const loserProvisionId =
        activeMembers?.[0]?.user_id === hire1Id ? result2.provisionId : result1.provisionId;
      const { data: loserProvision } = await serviceClient
        .from('organization_staff_provisions')
        .select('status')
        .eq('id', loserProvisionId)
        .single();
      expect(loserProvision?.status).toBe('awaiting_activation');
    }, 20000);
  },
);
