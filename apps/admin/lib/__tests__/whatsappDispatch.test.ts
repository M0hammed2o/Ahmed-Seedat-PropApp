import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { dispatchWhatsApp, resolveOrgWhatsAppBranding } from '../whatsappDispatch';

// Real integration test against local Supabase, same pattern as emailDispatch.test.ts.

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

describeIfSupabase('dispatchWhatsApp (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let userId: string;

  beforeEach(async () => {
    const { data: org, error: orgError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `WhatsApp Dispatch Vitest Org ${Date.now()}`, org_type: 'agency' })
      .select('id')
      .single();
    if (orgError) throw orgError;
    orgId = org.id;

    const { data: authUser, error: authError } = await serviceClient.auth.admin.createUser({
      email: `whatsapp-dispatch-vitest-${Date.now()}@propertyvault.example`,
      password: 'TestPassw0rd!23',
      email_confirm: true,
    });
    if (authError) throw authError;
    userId = authUser.user.id;
  });

  afterEach(async () => {
    await serviceClient.from('whatsapp_messages').delete().eq('org_id', orgId);
    await serviceClient.from('notification_preferences').delete().eq('user_id', userId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.auth.admin.deleteUser(userId);
  });

  it('sends and writes a real whatsapp_messages row', async () => {
    const result = await dispatchWhatsApp(serviceClient, {
      orgId,
      toPhone: '+27821234567',
      templateName: 'payment_accepted',
      variables: { amount: '5000' },
      relatedEntityType: 'bank_transaction',
      relatedEntityId: crypto.randomUUID(),
      actorUserId: null,
    });
    expect(result.sent).toBe(true);

    const { data } = await serviceClient
      .from('whatsapp_messages')
      .select('*')
      .eq('id', result.whatsappMessageId)
      .single();
    expect(data.to_number).toBe('+27821234567');
    expect(data.template_name).toBe('payment_accepted');
    expect(data.status).toBe('queued');
    expect(data.direction).toBe('outbound');
  });

  it('does not send twice for the same (relatedEntityType, relatedEntityId, templateName)', async () => {
    const entityId = crypto.randomUUID();
    const first = await dispatchWhatsApp(serviceClient, {
      orgId,
      toPhone: '+27821234567',
      templateName: 'owner_statement_available',
      variables: {},
      relatedEntityType: 'owner_statement',
      relatedEntityId: entityId,
      actorUserId: null,
    });
    const second = await dispatchWhatsApp(serviceClient, {
      orgId,
      toPhone: '+27821234567',
      templateName: 'owner_statement_available',
      variables: {},
      relatedEntityType: 'owner_statement',
      relatedEntityId: entityId,
      actorUserId: null,
    });

    expect(first.sent).toBe(true);
    expect(second.sent).toBe(false);
    expect(second.reason).toBe('already_sent');
  });

  it('rejects a malformed (non-E.164) phone number without sending', async () => {
    const result = await dispatchWhatsApp(serviceClient, {
      orgId,
      toPhone: '082 123 4567',
      templateName: 'payment_accepted',
      variables: {},
      relatedEntityType: 'bank_transaction',
      relatedEntityId: crypto.randomUUID(),
      actorUserId: null,
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('invalid_phone');
  });

  it('returns sent:false with reason "no_phone" when there is no phone at all', async () => {
    const result = await dispatchWhatsApp(serviceClient, {
      orgId,
      toPhone: null,
      templateName: 'payment_accepted',
      variables: {},
      relatedEntityType: 'bank_transaction',
      relatedEntityId: crypto.randomUUID(),
      actorUserId: null,
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('no_phone');
  });

  it('respects notification_preferences.whatsapp_enabled=false', async () => {
    await serviceClient
      .from('notification_preferences')
      .insert({ user_id: userId, category: 'maintenance', whatsapp_enabled: false });

    const result = await dispatchWhatsApp(serviceClient, {
      orgId,
      toPhone: '+27821234567',
      toUserId: userId,
      templateName: 'maintenance_update_critical',
      variables: { summary: 'Burst pipe', status: 'in_progress' },
      relatedEntityType: 'maintenance_ticket',
      relatedEntityId: crypto.randomUUID(),
      actorUserId: null,
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('preference_disabled');
  });

  it('sends when there is no notification_preferences row at all (default enabled)', async () => {
    const result = await dispatchWhatsApp(serviceClient, {
      orgId,
      toPhone: '+27821234567',
      toUserId: userId,
      templateName: 'maintenance_update_critical',
      variables: { summary: 'Burst pipe', status: 'in_progress' },
      relatedEntityType: 'maintenance_ticket',
      relatedEntityId: crypto.randomUUID(),
      actorUserId: null,
    });
    expect(result.sent).toBe(true);
  });

  describe('resolveOrgWhatsAppBranding', () => {
    it('prefers trading_name over legal_name, and passes through support_contact_name', async () => {
      await serviceClient
        .from('organizations')
        .update({ trading_name: 'Acme Rentals', support_contact_name: 'Jane from Acme' })
        .eq('id', orgId);

      const branding = await resolveOrgWhatsAppBranding(serviceClient, orgId);
      expect(branding.organizationName).toBe('Acme Rentals');
      expect(branding.supportName).toBe('Jane from Acme');
    });

    it('falls back to legal_name when trading_name is not set, and empty support name when unset', async () => {
      const branding = await resolveOrgWhatsAppBranding(serviceClient, orgId);
      expect(branding.organizationName).toContain('WhatsApp Dispatch Vitest Org');
      expect(branding.supportName).toBe('');
    });

    it('falls back to a generic name for an unknown org id', async () => {
      const branding = await resolveOrgWhatsAppBranding(serviceClient, crypto.randomUUID());
      expect(branding.organizationName).toBe('your property manager');
      expect(branding.supportName).toBe('');
    });
  });
});
