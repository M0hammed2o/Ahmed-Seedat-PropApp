import crypto from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { processResendWebhookEvent } from '../emailDispatch';

// Real integration test against local Supabase (same pattern as emailDispatch.test.ts/
// billing.test.ts). Sets real RESEND_API_KEY/RESEND_FROM_ADDRESS/RESEND_WEBHOOK_SECRET env vars
// for the duration of this file (fake test values, never real credentials) so
// processResendWebhookEvent()'s internal getEmailProvider() resolves to the REAL
// ResendEmailProvider -- exercising the actual Svix verification path end-to-end, not a
// lower-security Mock stand-in. Never calls real Resend (no network -- signature verification is
// pure local HMAC; parseWebhookEvent is pure JSON parsing).

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

const WEBHOOK_SECRET =
  'whsec_' + Buffer.from('resend-webhook-vitest-secret-32b').toString('base64');

function signSvix(id: string, timestamp: string, body: string, secret = WEBHOOK_SECRET): string {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${body}`;
  const sig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  return `v1,${sig}`;
}

function eventBody(type: string, emailId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type,
    created_at: new Date().toISOString(),
    data: { email_id: emailId, ...extra },
  });
}

function validHeaders(id: string, body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return { id, timestamp, signature: signSvix(id, timestamp, body) };
}

describeIfSupabase('processResendWebhookEvent (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const originalEnv = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_ADDRESS: process.env.RESEND_FROM_ADDRESS,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
  };
  beforeAll(() => {
    process.env.RESEND_API_KEY = 'test-resend-api-key';
    process.env.RESEND_FROM_ADDRESS = 'PropertyVault <billing@propertyvault.example>';
    process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });
  afterAll(() => {
    process.env.RESEND_API_KEY = originalEnv.RESEND_API_KEY;
    process.env.RESEND_FROM_ADDRESS = originalEnv.RESEND_FROM_ADDRESS;
    process.env.RESEND_WEBHOOK_SECRET = originalEnv.RESEND_WEBHOOK_SECRET;
  });

  let orgId: string;
  let orgId2: string;
  let messageId: string;
  const providerMessageId = () => `em_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let thisMessageProviderId: string;

  beforeEach(async () => {
    const { data: org, error: orgError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Resend Webhook Vitest Org ${Date.now()}`, org_type: 'agency' })
      .select('id')
      .single();
    if (orgError) throw orgError;
    orgId = org.id;

    const { data: org2, error: orgError2 } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Resend Webhook Vitest Org B ${Date.now()}`, org_type: 'agency' })
      .select('id')
      .single();
    if (orgError2) throw orgError2;
    orgId2 = org2.id;

    thisMessageProviderId = providerMessageId();
    const { data: message, error: messageError } = await serviceClient
      .from('email_messages')
      .insert({
        org_id: orgId,
        to_address: 'tenant@example.com',
        subject: 'Test subject',
        template_name: 'invoice_issued',
        status: 'queued',
        provider_message_id: thisMessageProviderId,
      })
      .select('id')
      .single();
    if (messageError) throw messageError;
    messageId = message.id;
  });

  afterEach(async () => {
    await serviceClient.from('email_webhook_events').delete().eq('org_id', orgId);
    await serviceClient.from('email_webhook_events').delete().eq('org_id', orgId2);
    await serviceClient.from('email_suppressions').delete().eq('org_id', orgId);
    await serviceClient.from('email_messages').delete().eq('org_id', orgId);
    await serviceClient.from('email_messages').delete().eq('org_id', orgId2);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.from('organizations').delete().eq('id', orgId2);
  });

  it('a valid signed delivered event updates the correct message', async () => {
    const body = eventBody('email.delivered', thisMessageProviderId);
    const result = await processResendWebhookEvent(serviceClient, {
      rawBody: body,
      headers: validHeaders('msg_1', body),
    });
    expect(result.alreadyProcessed).toBe(false);

    const { data: after } = await serviceClient
      .from('email_messages')
      .select('status, delivered_at')
      .eq('id', messageId)
      .single();
    expect(after?.status).toBe('delivered');
    expect(after?.delivered_at).not.toBeNull();
  });

  it('a valid bounce event updates the correct message and records failure_reason', async () => {
    const body = eventBody('email.bounced', thisMessageProviderId, {
      bounce: { type: 'Permanent' },
    });
    await processResendWebhookEvent(serviceClient, {
      rawBody: body,
      headers: validHeaders('msg_2', body),
    });

    const { data: after } = await serviceClient
      .from('email_messages')
      .select('status, bounced_at, failure_reason')
      .eq('id', messageId)
      .single();
    expect(after?.status).toBe('bounced');
    expect(after?.bounced_at).not.toBeNull();
    expect(after?.failure_reason).toBe('Permanent');
  });

  it('a permanent bounce suppresses future sends to that address', async () => {
    const body = eventBody('email.bounced', thisMessageProviderId, {
      bounce: { type: 'Permanent' },
    });
    await processResendWebhookEvent(serviceClient, {
      rawBody: body,
      headers: validHeaders('msg_3', body),
    });

    const { data: suppression } = await serviceClient
      .from('email_suppressions')
      .select('reason')
      .eq('org_id', orgId)
      .eq('email_address', 'tenant@example.com')
      .maybeSingle();
    expect(suppression?.reason).toBe('hard_bounce');
  });

  it('a spam complaint suppresses future sends without changing status', async () => {
    const body = eventBody('email.complained', thisMessageProviderId);
    await processResendWebhookEvent(serviceClient, {
      rawBody: body,
      headers: validHeaders('msg_4', body),
    });

    const { data: after } = await serviceClient
      .from('email_messages')
      .select('status')
      .eq('id', messageId)
      .single();
    expect(after?.status).toBe('queued'); // unchanged -- complaint is not a delivery-status enum value

    const { data: suppression } = await serviceClient
      .from('email_suppressions')
      .select('reason')
      .eq('org_id', orgId)
      .eq('email_address', 'tenant@example.com')
      .maybeSingle();
    expect(suppression?.reason).toBe('spam_complaint');
  });

  it('a duplicate delivery of the same event id is idempotent (no double side effects)', async () => {
    const body = eventBody('email.delivered', thisMessageProviderId);
    const headers = validHeaders('msg_dup', body);

    const first = await processResendWebhookEvent(serviceClient, { rawBody: body, headers });
    expect(first.alreadyProcessed).toBe(false);
    const second = await processResendWebhookEvent(serviceClient, { rawBody: body, headers });
    expect(second.alreadyProcessed).toBe(true);

    const { data: events } = await serviceClient
      .from('email_webhook_events')
      .select('id')
      .eq('provider_event_id', 'msg_dup');
    expect(events).toHaveLength(1);
  });

  it('rejects an invalid signature', async () => {
    const body = eventBody('email.delivered', thisMessageProviderId);
    await expect(
      processResendWebhookEvent(serviceClient, {
        rawBody: body,
        headers: {
          id: 'msg_bad',
          timestamp: String(Math.floor(Date.now() / 1000)),
          signature: 'v1,notarealsignature',
        },
      }),
    ).rejects.toThrow(/signature/i);

    const { data: after } = await serviceClient
      .from('email_messages')
      .select('status')
      .eq('id', messageId)
      .single();
    expect(after?.status).toBe('queued'); // untouched
  });

  it('rejects a missing signature', async () => {
    const body = eventBody('email.delivered', thisMessageProviderId);
    await expect(
      processResendWebhookEvent(serviceClient, {
        rawBody: body,
        headers: { id: null, timestamp: null, signature: null },
      }),
    ).rejects.toThrow(/signature/i);
  });

  it('handles an unknown provider_message_id safely (no crash, no row created)', async () => {
    const body = eventBody('email.delivered', 'em_never_sent_by_us');
    const result = await processResendWebhookEvent(serviceClient, {
      rawBody: body,
      headers: validHeaders('msg_unknown', body),
    });
    expect(result.alreadyProcessed).toBe(false);
    expect(result.eventType).toBe('delivered');
    // The event itself is still recorded (it WAS authentic) but with no email_message_id.
    const { data: event } = await serviceClient
      .from('email_webhook_events')
      .select('email_message_id, org_id')
      .eq('provider_event_id', 'msg_unknown')
      .single();
    expect(event?.email_message_id).toBeNull();
    await serviceClient
      .from('email_webhook_events')
      .delete()
      .eq('provider_event_id', 'msg_unknown');
  });

  it('rejects a malformed payload', async () => {
    const body = 'not valid json at all';
    await expect(
      processResendWebhookEvent(serviceClient, {
        rawBody: body,
        headers: validHeaders('msg_malformed', body),
      }),
    ).rejects.toThrow();
  });

  it('a delivered message is never regressed by a stale sent event arriving after', async () => {
    const deliveredBody = eventBody('email.delivered', thisMessageProviderId);
    await processResendWebhookEvent(serviceClient, {
      rawBody: deliveredBody,
      headers: validHeaders('msg_delivered_first', deliveredBody),
    });

    const staleSentBody = eventBody('email.sent', thisMessageProviderId);
    await processResendWebhookEvent(serviceClient, {
      rawBody: staleSentBody,
      headers: validHeaders('msg_stale_sent', staleSentBody),
    });

    const { data: after } = await serviceClient
      .from('email_messages')
      .select('status')
      .eq('id', messageId)
      .single();
    expect(after?.status).toBe('delivered'); // never regressed back to 'sent'
  });

  it('leaves an unrelated email message completely untouched', async () => {
    const { data: unrelated } = await serviceClient
      .from('email_messages')
      .insert({
        org_id: orgId2,
        to_address: 'other@example.com',
        subject: 'Unrelated',
        template_name: 'invoice_issued',
        status: 'queued',
        provider_message_id: providerMessageId(),
      })
      .select('id')
      .single();

    const body = eventBody('email.delivered', thisMessageProviderId);
    await processResendWebhookEvent(serviceClient, {
      rawBody: body,
      headers: validHeaders('msg_unrelated', body),
    });

    const { data: unrelatedAfter } = await serviceClient
      .from('email_messages')
      .select('status')
      .eq('id', unrelated!.id)
      .single();
    expect(unrelatedAfter?.status).toBe('queued'); // completely untouched
  });

  it("does not leak cross-organization data: the webhook event row is scoped to the message's own org", async () => {
    const body = eventBody('email.delivered', thisMessageProviderId);
    await processResendWebhookEvent(serviceClient, {
      rawBody: body,
      headers: validHeaders('msg_org_scope', body),
    });

    const { data: event } = await serviceClient
      .from('email_webhook_events')
      .select('org_id')
      .eq('provider_event_id', 'msg_org_scope')
      .single();
    expect(event?.org_id).toBe(orgId);
    expect(event?.org_id).not.toBe(orgId2);
  });

  it('never returns or throws the configured webhook secret', async () => {
    const body = eventBody('email.delivered', thisMessageProviderId);
    const result = await processResendWebhookEvent(serviceClient, {
      rawBody: body,
      headers: validHeaders('msg_secret_check', body),
    });
    expect(JSON.stringify(result)).not.toContain(WEBHOOK_SECRET.replace('whsec_', ''));
  });
});
