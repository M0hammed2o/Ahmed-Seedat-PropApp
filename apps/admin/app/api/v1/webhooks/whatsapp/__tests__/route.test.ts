import { afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// External-communications release-gate pass: end-to-end coverage of the ACTUAL HTTP webhook route,
// driven with REAL Meta-shaped payloads and REAL HMAC signatures.
//
// lib/__tests__/whatsappDispatch.test.ts already covers processWhatsAppWebhookEvent() directly
// (status transitions, inbound resolution branches, idempotency). What was never tested is the
// route Meta actually talks to: signature rejection producing 401 plus a security audit event,
// malformed bodies producing 400 rather than a retry-forever 5xx, the GET verification handshake,
// and duplicate deliveries still answering 2xx (anything else makes Meta retry the same event
// indefinitely).
//
// WHY REAL META CONFIG IS SET BELOW, AND WHY IT IS NOT "INVENTING CREDENTIALS":
// MockWhatsAppProvider speaks a deliberately simplified payload dialect (a top-level `status`
// field) and always returns true from verifyWebhookSignature(). Neither matches production. With
// the three WHATSAPP_* values set, getWhatsAppProvider() returns the REAL MetaWhatsAppProvider, so
// these tests exercise the real Meta `entry[].changes[].value` parsing and the real
// X-Hub-Signature-256 HMAC path -- the code that will actually run in production.
//
// The values below are local test doubles for an HMAC computation, not access to anything: the
// webhook path only verifies signatures and parses payloads. It never calls the Graph API, so no
// network request to Meta is possible from these tests. Sending (which would use the token) is not
// on this code path at all.

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const TEST_WEBHOOK_SECRET = 'local-test-webhook-secret-not-a-real-meta-app-secret';
const TEST_VERIFY_TOKEN = 'local-test-verify-token';

process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
process.env.WHATSAPP_ACCESS_TOKEN = 'local-test-token-never-sent-anywhere';
process.env.WHATSAPP_PHONE_NUMBER_ID = '000000000000000';
process.env.WHATSAPP_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = TEST_VERIFY_TOKEN;

vi.mock('next/headers', () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({ get: () => undefined, set: () => {}, getAll: () => [] }),
}));

const { GET, POST } = await import('../route');

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

/** Exactly how Meta signs a webhook: HMAC-SHA256 over the raw body, keyed by the app secret. */
function sign(rawBody: string, secret = TEST_WEBHOOK_SECRET) {
  return `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

function metaStatusPayload(providerMessageId: string, status: string) {
  return { entry: [{ changes: [{ value: { statuses: [{ id: providerMessageId, status }] } }] }] };
}

function metaInboundPayload(from: string, body: string, providerMessageId: string) {
  return {
    entry: [
      { changes: [{ value: { messages: [{ id: providerMessageId, from, text: { body } }] } }] },
    ],
  };
}

/** Meta sends the number without a leading '+'; the provider re-adds it when parsing. */
function metaFrom(e164: string) {
  return e164.replace(/^\+/, '');
}

function postRequest(payload: unknown, opts: { signature?: string; raw?: string } = {}) {
  const rawBody = opts.raw ?? JSON.stringify(payload);
  return new NextRequest('http://localhost/api/v1/webhooks/whatsapp', {
    method: 'POST',
    body: rawBody,
    headers: {
      'x-hub-signature-256': opts.signature ?? sign(rawBody),
      'content-type': 'application/json',
    },
  });
}

describeIfSupabase('POST /api/v1/webhooks/whatsapp (real route, real Meta payloads + HMAC)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const createdOrgIds: string[] = [];
  const createdEventIds: string[] = [];

  afterAll(async () => {
    for (const id of createdEventIds) {
      await serviceClient.from('whatsapp_webhook_events').delete().eq('provider_event_id', id);
      await serviceClient.from('whatsapp_messages').delete().eq('provider_message_id', id);
    }
    for (const orgId of createdOrgIds) {
      await serviceClient.from('whatsapp_webhook_events').delete().eq('org_id', orgId);
      await serviceClient.from('whatsapp_messages').delete().eq('org_id', orgId);
      await serviceClient.from('verified_phone_numbers').delete().eq('org_id', orgId);
      await serviceClient.from('tenants').delete().eq('org_id', orgId);
      await serviceClient.from('organizations').delete().eq('id', orgId);
    }
  });

  it('rejects a payload whose signature does not match, with 401 and no stored event', async () => {
    const payload = metaStatusPayload(`wamid.bad-sig-${crypto.randomUUID()}`, 'delivered');
    const raw = JSON.stringify(payload);
    const res = await POST(postRequest(payload, { signature: sign(raw, 'the-wrong-secret') }));

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('invalid_signature');

    // Nothing may be recorded for a request that failed authentication.
    const id = payload.entry[0].changes[0].value.statuses[0].id;
    const { count } = await serviceClient
      .from('whatsapp_webhook_events')
      .select('id', { count: 'exact', head: true })
      .eq('provider_event_id', `${id}:delivered`);
    expect(count ?? 0).toBe(0);
  });

  it('rejects a tampered body -- the signature is over the exact bytes, not the parsed object', async () => {
    const original = JSON.stringify(metaStatusPayload('wamid.original', 'delivered'));
    const tampered = JSON.stringify(metaStatusPayload('wamid.tampered', 'delivered'));
    // Valid signature, but for a DIFFERENT body than the one delivered.
    const res = await POST(postRequest(null, { raw: tampered, signature: sign(original) }));
    expect(res.status).toBe(401);
  });

  it('rejects a request with no signature header at all', async () => {
    const res = await POST(postRequest(metaStatusPayload('wamid.nosig', 'sent'), { signature: '' }));
    expect(res.status).toBe(401);
  });

  it('answers 200 to a well-formed status callback for a message this app never sent', async () => {
    // Authentic-but-unknown provider message id: recorded for audit, nothing local to update.
    // Must NOT be an error -- a 4xx/5xx here makes Meta retry the same event forever.
    const unknownId = `wamid.unknown-${crypto.randomUUID()}`;
    createdEventIds.push(`${unknownId}:delivered`);

    const res = await POST(postRequest(metaStatusPayload(unknownId, 'delivered')));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const { data: event } = await serviceClient
      .from('whatsapp_webhook_events')
      .select('event_type, whatsapp_message_id')
      .eq('provider_event_id', `${unknownId}:delivered`)
      .maybeSingle();
    expect(event?.event_type).toBe('status:delivered');
    expect(event?.whatsapp_message_id).toBeNull();
  });

  it('answers 200 and reports alreadyProcessed on a duplicate delivery, never a retry-triggering error', async () => {
    const id = `wamid.dup-${crypto.randomUUID()}`;
    createdEventIds.push(`${id}:sent`);

    const first = await POST(postRequest(metaStatusPayload(id, 'sent')));
    expect(first.status).toBe(200);
    expect((await first.json()).alreadyProcessed).toBe(false);

    const second = await POST(postRequest(metaStatusPayload(id, 'sent')));
    expect(second.status).toBe(200);
    expect((await second.json()).alreadyProcessed).toBe(true);

    const { count } = await serviceClient
      .from('whatsapp_webhook_events')
      .select('id', { count: 'exact', head: true })
      .eq('provider_event_id', `${id}:sent`);
    expect(count).toBe(1);
  });

  it('answers 400, not 500, for a body that is not valid JSON', async () => {
    const raw = 'this-is-not-json';
    const res = await POST(postRequest(null, { raw, signature: sign(raw) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('whatsapp_webhook_failed');
  });

  it('answers 200 to a signature-verified payload of an unrecognised shape rather than erroring', async () => {
    // Neither messages[] nor statuses[] -- an event type this integration does not model.
    // Authenticity was proven by the signature; Meta must not be told to retry.
    const res = await POST(postRequest({ entry: [{ changes: [{ value: {} }] }] }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('records an inbound message from an UNKNOWN number without attaching it to any org', async () => {
    const providerMessageId = `wamid.in-unknown-${crypto.randomUUID()}`;
    createdEventIds.push(providerMessageId);

    const res = await POST(
      postRequest(metaInboundPayload(metaFrom('+27999000111'), 'hello', providerMessageId)),
    );
    expect(res.status).toBe(200);

    const { data: event } = await serviceClient
      .from('whatsapp_webhook_events')
      .select('org_id, event_type')
      .eq('provider_event_id', providerMessageId)
      .maybeSingle();
    expect(event?.event_type).toBe('inbound_message');
    // UNAUTHENTICATED: durably recorded for audit, never promoted into org-scoped data.
    expect(event?.org_id).toBeNull();

    const { count } = await serviceClient
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('provider_message_id', providerMessageId);
    expect(count).toBe(0);
  });

  // The cross-ORG case is covered in whatsappDispatch.test.ts. This is the same-ORG case: two
  // tenants of ONE organisation, which org-scoped RLS cannot separate at all -- resolution rests
  // entirely on the phone -> entity mapping being exact.
  it('resolves two tenants in the SAME org to their own records, with no cross-tenant bleed', async () => {
    const { data: org } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `WA Route Same-Org ${Date.now()}`, org_type: 'agency' })
      .select('id')
      .single();
    createdOrgIds.push(org!.id);

    const { data: tenantA } = await serviceClient
      .from('tenants')
      .insert({ org_id: org!.id, full_name: 'WA Route Tenant A', status: 'active' })
      .select('id')
      .single();
    const { data: tenantB } = await serviceClient
      .from('tenants')
      .insert({ org_id: org!.id, full_name: 'WA Route Tenant B', status: 'active' })
      .select('id')
      .single();

    const phoneA = '+27820000771';
    const phoneB = '+27820000772';
    await serviceClient.from('verified_phone_numbers').insert([
      { org_id: org!.id, entity_type: 'tenant', entity_id: tenantA!.id, phone_number_e164: phoneA },
      { org_id: org!.id, entity_type: 'tenant', entity_id: tenantB!.id, phone_number_e164: phoneB },
    ]);

    const idA = `wamid.same-org-a-${crypto.randomUUID()}`;
    const idB = `wamid.same-org-b-${crypto.randomUUID()}`;
    createdEventIds.push(idA, idB);

    expect((await POST(postRequest(metaInboundPayload(metaFrom(phoneA), 'from A', idA)))).status).toBe(200);
    expect((await POST(postRequest(metaInboundPayload(metaFrom(phoneB), 'from B', idB)))).status).toBe(200);

    const { data: msgA } = await serviceClient
      .from('whatsapp_messages')
      .select('related_entity_id, org_id, from_number, body')
      .eq('provider_message_id', idA)
      .maybeSingle();
    const { data: msgB } = await serviceClient
      .from('whatsapp_messages')
      .select('related_entity_id, org_id, from_number, body')
      .eq('provider_message_id', idB)
      .maybeSingle();

    expect(msgA?.related_entity_id).toBe(tenantA!.id);
    expect(msgB?.related_entity_id).toBe(tenantB!.id);
    // The decisive assertion: neither message resolved to the other tenant.
    expect(msgA?.related_entity_id).not.toBe(tenantB!.id);
    expect(msgB?.related_entity_id).not.toBe(tenantA!.id);
    expect(msgA?.body).toBe('from A');
    expect(msgB?.body).toBe('from B');
  });
});

describe('GET /api/v1/webhooks/whatsapp (Meta verification handshake)', () => {
  function getRequest(params: Record<string, string>) {
    return new NextRequest(
      `http://localhost/api/v1/webhooks/whatsapp?${new URLSearchParams(params).toString()}`,
    );
  }

  it('echoes the challenge for a correct verify token', async () => {
    const res = await GET(
      getRequest({
        'hub.mode': 'subscribe',
        'hub.verify_token': TEST_VERIFY_TOKEN,
        'hub.challenge': '1158201444',
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('1158201444');
  });

  it('refuses -- and does not echo the challenge -- for a wrong verify token', async () => {
    const res = await GET(
      getRequest({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': '1158201444',
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('1158201444');
  });

  it('refuses a handshake with a wrong mode even when the token is correct', async () => {
    const res = await GET(
      getRequest({
        'hub.mode': 'unsubscribe',
        'hub.verify_token': TEST_VERIFY_TOKEN,
        'hub.challenge': '1158201444',
      }),
    );
    expect(res.status).toBe(403);
  });
});
