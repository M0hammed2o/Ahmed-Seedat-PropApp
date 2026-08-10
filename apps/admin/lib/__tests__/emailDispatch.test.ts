import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { dispatchEmail } from '../emailDispatch';

// Real integration test against local Supabase (same pattern as billing.test.ts/server.test.ts)
// -- the idempotency and suppression checks are real DB reads, not mockable logic worth testing
// against a fake client.

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

describeIfSupabase('dispatchEmail (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let userId: string;

  beforeEach(async () => {
    const { data: org, error: orgError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Email Dispatch Vitest Org ${Date.now()}`, org_type: 'agency' })
      .select('id')
      .single();
    if (orgError) throw orgError;
    orgId = org.id;

    const { data: authUser, error: authError } = await serviceClient.auth.admin.createUser({
      email: `email-dispatch-vitest-${Date.now()}@propertyvault.example`,
      password: 'TestPassw0rd!23',
      email_confirm: true,
    });
    if (authError) throw authError;
    userId = authUser.user.id;
  });

  afterEach(async () => {
    await serviceClient.from('email_messages').delete().eq('org_id', orgId);
    await serviceClient.from('email_suppressions').delete().eq('org_id', orgId);
    await serviceClient.from('notification_preferences').delete().eq('user_id', userId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(userId);
  });

  it('sends and writes a real email_messages row', async () => {
    const result = await dispatchEmail(serviceClient, {
      orgId,
      toAddress: 'tenant@example.com',
      templateName: 'invoice_issued',
      templateVars: { propertyAddress: '1 Test St', amount: 5000 },
      relatedEntityType: 'invoice',
      relatedEntityId: crypto.randomUUID(),
      actorUserId: null,
    });
    expect(result.sent).toBe(true);
    // Overnight platform pass (WORKLOG.md this date): root-cause regression test for "invitation
    // shows pending but no email arrives" -- no RESEND_API_KEY/RESEND_FROM_ADDRESS is set in this
    // test environment, so dispatchEmail() must honestly report deliveryConfigured: false even
    // though `sent` is true (MockEmailProvider "sends" successfully, it just never leaves the
    // server) -- the two are deliberately different signals now, not one conflated boolean.
    expect(result.deliveryConfigured).toBe(false);

    const { data } = await serviceClient
      .from('email_messages')
      .select('*')
      .eq('id', result.emailMessageId)
      .single();
    expect(data.to_address).toBe('tenant@example.com');
    expect(data.template_name).toBe('invoice_issued');
    expect(data.status).toBe('queued');
  });

  it('does not send twice for the same (relatedEntityType, relatedEntityId, templateName)', async () => {
    const invoiceId = crypto.randomUUID();
    const first = await dispatchEmail(serviceClient, {
      orgId,
      toAddress: 'tenant@example.com',
      templateName: 'invoice_issued',
      templateVars: {},
      relatedEntityType: 'invoice',
      relatedEntityId: invoiceId,
      actorUserId: null,
    });
    const second = await dispatchEmail(serviceClient, {
      orgId,
      toAddress: 'tenant@example.com',
      templateName: 'invoice_issued',
      templateVars: {},
      relatedEntityType: 'invoice',
      relatedEntityId: invoiceId,
      actorUserId: null,
    });

    expect(first.sent).toBe(true);
    expect(second.sent).toBe(false);
    expect(second.reason).toBe('already_sent');

    const { count } = await serviceClient
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('related_entity_id', invoiceId);
    expect(count).toBe(1);
  });

  it("a resend-style suffixed relatedEntityId is a genuinely new dispatch, not swallowed by the original send's idempotency guard", async () => {
    // Overnight platform pass (WORKLOG.md this date): real bug found and fixed in
    // POST /api/v1/organization-invites/:id/resend -- it previously reused the SAME
    // relatedEntityType+relatedEntityId the original invite-creation dispatch already consumed,
    // so every "Resend" click was silently absorbed by the test above's exact idempotency guard
    // and never actually re-dispatched. email_messages.related_entity_id is a real `uuid` column
    // (confirmed by reading the migration -- an earlier version of this fix tried suffixing the
    // id itself and failed with "invalid input syntax for type uuid" against a real database, not
    // assumed safe), so the fix varies related_entity_type instead (plain text,
    // `organization_invites:resend:${resendCount}`, migration 20260101000091's resend_count) --
    // this proves that pattern actually produces a second, real send.
    const inviteId = crypto.randomUUID();
    const original = await dispatchEmail(serviceClient, {
      orgId,
      toAddress: 'staff@example.com',
      templateName: 'member_invited',
      templateVars: {},
      relatedEntityType: 'organization_invites',
      relatedEntityId: inviteId,
      actorUserId: null,
    });
    const resend = await dispatchEmail(serviceClient, {
      orgId,
      toAddress: 'staff@example.com',
      templateName: 'member_invited',
      templateVars: {},
      relatedEntityType: 'organization_invites:resend:1',
      relatedEntityId: inviteId,
      actorUserId: null,
    });

    expect(original.sent).toBe(true);
    expect(resend.sent).toBe(true);
    expect(resend.reason).toBeUndefined();

    const { count } = await serviceClient
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('related_entity_id', inviteId);
    expect(count).toBe(2);
  });

  it('skips a suppressed address without sending', async () => {
    await serviceClient
      .from('email_suppressions')
      .insert({ org_id: orgId, email_address: 'bounced@example.com', reason: 'hard_bounce' });

    const result = await dispatchEmail(serviceClient, {
      orgId,
      toAddress: 'bounced@example.com',
      templateName: 'invoice_issued',
      templateVars: {},
      relatedEntityType: 'invoice',
      relatedEntityId: crypto.randomUUID(),
      actorUserId: null,
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('suppressed');
  });

  it('respects notification_preferences.email_enabled=false for a preference-gated category (maintenance_update)', async () => {
    await serviceClient
      .from('notification_preferences')
      .insert({ user_id: userId, category: 'maintenance', email_enabled: false });

    const result = await dispatchEmail(serviceClient, {
      orgId,
      toAddress: 'tenant@example.com',
      toUserId: userId,
      templateName: 'maintenance_update',
      templateVars: { summary: 'Leaking tap', status: 'in_progress' },
      relatedEntityType: 'maintenance_ticket:in_progress',
      relatedEntityId: crypto.randomUUID(),
      actorUserId: null,
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('preference_disabled');
  });

  it('sends a transactional template (invoice_issued) even with no notification_preferences row at all', async () => {
    const result = await dispatchEmail(serviceClient, {
      orgId,
      toAddress: 'tenant@example.com',
      toUserId: userId,
      templateName: 'invoice_issued',
      templateVars: {},
      relatedEntityType: 'invoice',
      relatedEntityId: crypto.randomUUID(),
      actorUserId: null,
    });
    expect(result.sent).toBe(true);
  });

  it('sends member_invited (Blocker #3, PWA_V1_COMPLETION_PLAN.md) for a real invite row', async () => {
    const inviteId = crypto.randomUUID();
    const result = await dispatchEmail(serviceClient, {
      orgId,
      toAddress: 'invitee@example.com',
      toUserId: null,
      templateName: 'member_invited',
      templateVars: {
        orgName: 'Test Org',
        role: 'agent',
        acceptUrl: 'http://localhost:3000/invitations/accept?token=abc',
      },
      relatedEntityType: 'organization_invites',
      relatedEntityId: inviteId,
      actorUserId: null,
    });
    expect(result.sent).toBe(true);

    const { data } = await serviceClient
      .from('email_messages')
      .select('*')
      .eq('id', result.emailMessageId)
      .single();
    expect(data.template_name).toBe('member_invited');
    expect(data.subject).toContain('Test Org');
  });

  it('returns sent:false with reason "no_address" when the recipient has no email', async () => {
    const relatedEntityId = crypto.randomUUID();
    const result = await dispatchEmail(serviceClient, {
      orgId,
      toAddress: null,
      templateName: 'invoice_issued',
      templateVars: {},
      relatedEntityType: 'invoice',
      relatedEntityId,
      actorUserId: null,
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('no_address');

    const { count } = await serviceClient
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('related_entity_id', relatedEntityId);
    expect(count).toBe(0);
  });
});
