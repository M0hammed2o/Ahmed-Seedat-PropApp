import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  dispatchWhatsApp,
  resolveOrgWhatsAppBranding,
  processWhatsAppWebhookEvent,
} from '../whatsappDispatch';

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
      templateName: 'payment_received_confirmation',
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
    expect(data.template_name).toBe('payment_received_confirmation');
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
      templateName: 'payment_received_confirmation',
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
      templateName: 'payment_received_confirmation',
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
      templateName: 'maintenance_request_update',
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
      templateName: 'maintenance_request_update',
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

// V1 communications productionisation (WORKLOG.md this date): processWhatsAppWebhookEvent's real
// integration coverage -- against real local Supabase (migration 20260101000105's new columns/
// table), through MockWhatsAppProvider (no real Meta credentials in this test environment,
// matching every other provider test in this codebase). MockWhatsAppProvider.verifyWebhookSignature
// always returns true (see providers/whatsapp.ts) -- real HMAC accept/reject logic is covered
// separately and directly in providers/__tests__/whatsapp.test.ts against MetaWhatsAppProvider,
// which needs no live account since it's a pure local computation.
describeIfSupabase('processWhatsAppWebhookEvent (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let otherOrgId: string;

  beforeEach(async () => {
    const { data: org, error: orgError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `WhatsApp Webhook Vitest Org ${Date.now()}`, org_type: 'agency' })
      .select('id')
      .single();
    if (orgError) throw orgError;
    orgId = org.id;

    const { data: otherOrg, error: otherOrgError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `WhatsApp Webhook Vitest Org B ${Date.now()}`, org_type: 'agency' })
      .select('id')
      .single();
    if (otherOrgError) throw otherOrgError;
    otherOrgId = otherOrg.id;
  });

  afterEach(async () => {
    await serviceClient.from('whatsapp_webhook_events').delete().eq('org_id', orgId);
    await serviceClient.from('whatsapp_messages').delete().eq('org_id', orgId);
    await serviceClient.from('verified_phone_numbers').delete().eq('org_id', orgId);
    await serviceClient.from('verified_phone_numbers').delete().eq('org_id', otherOrgId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.from('organizations').delete().eq('id', otherOrgId);
  });

  describe('status callbacks', () => {
    it('updates whatsapp_messages.status and the matching timestamp column on a real status callback', async () => {
      const providerMessageId = `wamid-vitest-${crypto.randomUUID()}`;
      const { data: message } = await serviceClient
        .from('whatsapp_messages')
        .insert({
          org_id: orgId,
          direction: 'outbound',
          to_number: '+27821234567',
          from_number: '+27000000000',
          template_name: 'payment_received_confirmation',
          status: 'sent',
          provider_message_id: providerMessageId,
        })
        .select('id')
        .single();

      const result = await processWhatsAppWebhookEvent(serviceClient, {
        rawBody: JSON.stringify({ providerMessageId, status: 'delivered' }),
        signatureHeader: 'irrelevant-in-mock-mode',
      });
      expect(result.alreadyProcessed).toBe(false);
      expect(result.eventType).toBe('status_callback');

      const { data: updated } = await serviceClient
        .from('whatsapp_messages')
        .select('status, delivered_at')
        .eq('id', message!.id)
        .single();
      expect(updated!.status).toBe('delivered');
      expect(updated!.delivered_at).not.toBeNull();
    });

    it('is idempotent for a redelivered identical status callback', async () => {
      const providerMessageId = `wamid-vitest-${crypto.randomUUID()}`;
      await serviceClient.from('whatsapp_messages').insert({
        org_id: orgId,
        direction: 'outbound',
        to_number: '+27821234567',
        from_number: '+27000000000',
        template_name: 'payment_received_confirmation',
        status: 'sent',
        provider_message_id: providerMessageId,
      });

      const payload = {
        rawBody: JSON.stringify({ providerMessageId, status: 'delivered' }),
        signatureHeader: 'x',
      };
      const first = await processWhatsAppWebhookEvent(serviceClient, payload);
      const second = await processWhatsAppWebhookEvent(serviceClient, payload);
      expect(first.alreadyProcessed).toBe(false);
      expect(second.alreadyProcessed).toBe(true);
    });

    it('never regresses status on an out-of-order callback (forward-only rank)', async () => {
      const providerMessageId = `wamid-vitest-${crypto.randomUUID()}`;
      const { data: message } = await serviceClient
        .from('whatsapp_messages')
        .insert({
          org_id: orgId,
          direction: 'outbound',
          to_number: '+27821234567',
          from_number: '+27000000000',
          template_name: 'payment_received_confirmation',
          status: 'sent',
          provider_message_id: providerMessageId,
        })
        .select('id')
        .single();

      await processWhatsAppWebhookEvent(serviceClient, {
        rawBody: JSON.stringify({ providerMessageId, status: 'delivered' }),
        signatureHeader: 'x',
      });
      // A stale/out-of-order redelivery of the earlier 'sent' event arriving after 'delivered' --
      // must not move status backwards.
      await processWhatsAppWebhookEvent(serviceClient, {
        rawBody: JSON.stringify({ providerMessageId, status: 'sent' }),
        signatureHeader: 'x',
      });

      const { data: updated } = await serviceClient
        .from('whatsapp_messages')
        .select('status')
        .eq('id', message!.id)
        .single();
      expect(updated!.status).toBe('delivered');
    });

    it('records failure_reason and failed_at on a failed callback', async () => {
      const providerMessageId = `wamid-vitest-${crypto.randomUUID()}`;
      const { data: message } = await serviceClient
        .from('whatsapp_messages')
        .insert({
          org_id: orgId,
          direction: 'outbound',
          to_number: '+27821234567',
          from_number: '+27000000000',
          template_name: 'payment_received_confirmation',
          status: 'sent',
          provider_message_id: providerMessageId,
        })
        .select('id')
        .single();

      await processWhatsAppWebhookEvent(serviceClient, {
        rawBody: JSON.stringify({
          providerMessageId,
          status: 'failed',
          failureReason: 'Recipient number not on WhatsApp',
        }),
        signatureHeader: 'x',
      });

      const { data: updated } = await serviceClient
        .from('whatsapp_messages')
        .select('status, failed_at, failure_reason')
        .eq('id', message!.id)
        .single();
      expect(updated!.status).toBe('failed');
      expect(updated!.failed_at).not.toBeNull();
      expect(updated!.failure_reason).toBe('Recipient number not on WhatsApp');
    });
  });

  describe('inbound messages -- WHATSAPP.md §1.2 resolution', () => {
    // whatsapp_webhook_events rows for an UNAUTHENTICATED (0-match) inbound message always carry
    // org_id: null by design (see the migration/dispatch comments) -- afterEach above only scopes
    // its cleanup by org_id, so it can never delete these. A fixed literal phone number reused
    // across test runs would accumulate duplicate rows and make the exact-count assertions below
    // flaky (this failed exactly that way once during this pass); a per-run-unique number sidesteps
    // it entirely without needing a second, broader cleanup query.
    const uniqueFromNumber = (seed: string) => `+2782${Date.now().toString().slice(-7)}${seed}`;

    it('UNAUTHENTICATED (0 matches): records a webhook_events row with no org, creates no whatsapp_messages row', async () => {
      const fromNumber = uniqueFromNumber('1');
      const result = await processWhatsAppWebhookEvent(serviceClient, {
        rawBody: JSON.stringify({ from: fromNumber, body: 'Hi, is my rent due?' }),
        signatureHeader: 'x',
      });
      expect(result.eventType).toBe('message');

      const { data: messages } = await serviceClient
        .from('whatsapp_messages')
        .select('id')
        .eq('from_number', fromNumber);
      expect(messages).toEqual([]);

      const { data: events } = await serviceClient
        .from('whatsapp_webhook_events')
        .select('org_id')
        .eq('event_type', 'inbound_message')
        .contains('payload', { from: fromNumber });
      expect(events!.length).toBe(1);
      expect(events![0]!.org_id).toBeNull();
    });

    it('RESOLVED (exactly 1 match): creates an org-scoped whatsapp_messages row with the resolved entity', async () => {
      const fromNumber = uniqueFromNumber('2');
      const entityId = crypto.randomUUID();
      await serviceClient.from('verified_phone_numbers').insert({
        org_id: orgId,
        entity_type: 'tenant',
        entity_id: entityId,
        phone_number_e164: fromNumber,
      });

      const result = await processWhatsAppWebhookEvent(serviceClient, {
        rawBody: JSON.stringify({ from: fromNumber, body: 'Hi, is my rent due?' }),
        signatureHeader: 'x',
      });
      expect(result.eventType).toBe('message');

      const { data: messages } = await serviceClient
        .from('whatsapp_messages')
        .select('org_id, related_entity_type, related_entity_id, direction, body')
        .eq('from_number', fromNumber);
      expect(messages!.length).toBe(1);
      expect(messages![0]!.org_id).toBe(orgId);
      expect(messages![0]!.related_entity_type).toBe('tenant');
      expect(messages![0]!.related_entity_id).toBe(entityId);
      expect(messages![0]!.direction).toBe('inbound');
      expect(messages![0]!.body).toBe('Hi, is my rent due?');
    });

    it('AMBIGUOUS (2+ matches across different orgs): creates no whatsapp_messages row, never guesses an org', async () => {
      const fromNumber = uniqueFromNumber('3');
      await serviceClient.from('verified_phone_numbers').insert([
        {
          org_id: orgId,
          entity_type: 'tenant',
          entity_id: crypto.randomUUID(),
          phone_number_e164: fromNumber,
        },
        {
          org_id: otherOrgId,
          entity_type: 'owner',
          entity_id: crypto.randomUUID(),
          phone_number_e164: fromNumber,
        },
      ]);

      const result = await processWhatsAppWebhookEvent(serviceClient, {
        rawBody: JSON.stringify({ from: fromNumber, body: 'Hi' }),
        signatureHeader: 'x',
      });
      expect(result.eventType).toBe('message');

      const { data: messages } = await serviceClient
        .from('whatsapp_messages')
        .select('id')
        .eq('from_number', fromNumber);
      expect(messages).toEqual([]);
    });

    it('is idempotent for a redelivered identical inbound message (same providerMessageId)', async () => {
      const fromNumber = uniqueFromNumber('4');
      const providerMessageId = `wamid-inbound-${crypto.randomUUID()}`;
      const payload = {
        rawBody: JSON.stringify({ from: fromNumber, body: 'Hi', providerMessageId }),
        signatureHeader: 'x',
      };
      const first = await processWhatsAppWebhookEvent(serviceClient, payload);
      const second = await processWhatsAppWebhookEvent(serviceClient, payload);
      expect(first.alreadyProcessed).toBe(false);
      expect(second.alreadyProcessed).toBe(true);
    });
  });
});
