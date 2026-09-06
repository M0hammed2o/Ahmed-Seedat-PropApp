// Real inbound-WhatsApp UAT probe (external-communications release-gate pass).
//
// Drives the LIVE HTTP webhook endpoint end to end, exactly as Meta would, using real Meta-shaped
// payloads and real X-Hub-Signature-256 HMACs, and asserts the full chain:
//
//   WhatsApp -> webhook -> signature verification -> phone identity resolution
//            -> correct tenant/org context -> application record -> no cross-tenant leakage
//
// This exists because the mock provider cannot exercise any of it: MockWhatsAppProvider always
// returns true from verifyWebhookSignature() and parses a simplified payload dialect, so a run
// against the mock proves nothing about the code that runs in production. The script therefore
// requires the three WHATSAPP_* values to be present so the server selects MetaWhatsAppProvider,
// and it refuses to run otherwise rather than reporting a hollow pass.
//
// It sends NOTHING to Meta -- inbound webhooks are traffic FROM Meta, so this only POSTs to the
// local app. No outbound message, no API call, no cost.
//
// LOCAL ONLY. Usage (from apps/admin/, dev server running with the WHATSAPP_* values set):
//   node scripts/uat-whatsapp-inbound.mjs

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET;
const UAT_NUMBER = process.env.WHATSAPP_UAT_OVERRIDE_NUMBER ?? '+27837866021';

for (const [n, u] of [['APP_URL', APP_URL], ['SUPABASE_URL', SUPABASE_URL]]) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(u)) {
    console.error(`SAFETY: refusing non-local ${n}: ${u}`);
    process.exit(1);
  }
}

if (!WEBHOOK_SECRET) {
  console.error('BLOCKED: WHATSAPP_WEBHOOK_SECRET is not set in this process.');
  console.error('Without it the server selects MockWhatsAppProvider, whose signature check always');
  console.error('passes and whose payload parsing does not match Meta -- a run would prove nothing.');
  console.error('Set WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_WEBHOOK_SECRET');
  console.error('for the dev server AND this script, then re-run.');
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const results = [];
function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
}

const sign = (raw, secret = WEBHOOK_SECRET) =>
  `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

const inboundPayload = (fromE164, body, id) => ({
  entry: [
    {
      changes: [
        { value: { messages: [{ id, from: fromE164.replace(/^\+/, ''), text: { body } }] } },
      ],
    },
  ],
});

async function postWebhook(payload, { signature, raw } = {}) {
  const rawBody = raw ?? JSON.stringify(payload);
  const res = await fetch(`${APP_URL}/api/v1/webhooks/whatsapp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signature ?? sign(rawBody),
    },
    body: rawBody,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

async function main() {
  console.log('=== Inbound WhatsApp UAT probe ===');
  console.log(`App: ${APP_URL} (local)   UAT number: ${UAT_NUMBER}`);
  console.log('Direction: INBOUND only -- nothing is sent to Meta.\n');

  const { data: org } = await admin
    .from('organizations').select('id').ilike('legal_name', 'Proplyst Demo Portfolio%').maybeSingle();
  if (!org) throw new Error('Demo portfolio org not found -- run the seed script first.');

  const { data: mapping } = await admin
    .from('verified_phone_numbers')
    .select('entity_id, entity_type, org_id')
    .eq('phone_number_e164', UAT_NUMBER)
    .maybeSingle();
  if (!mapping) {
    console.error(`BLOCKED: no verified_phone_numbers row for ${UAT_NUMBER}.`);
    console.error('Run the demo seed script, which creates the UAT inbound mapping.');
    process.exit(2);
  }
  const { data: tenant } = await admin
    .from('tenants').select('full_name').eq('id', mapping.entity_id).single();
  console.log(`Mapped: ${UAT_NUMBER} -> tenant "${tenant.full_name}" (org ${mapping.org_id})\n`);

  const createdIds = [];

  // 1. Valid inbound from the UAT number resolves to exactly that tenant.
  const id1 = `wamid.uat-${crypto.randomUUID()}`;
  createdIds.push(id1);
  const r1 = await postWebhook(inboundPayload(UAT_NUMBER, 'UAT inbound test message', id1));
  record('Valid inbound accepted', r1.status === 200, `HTTP ${r1.status}`);

  const { data: msg } = await admin
    .from('whatsapp_messages')
    .select('org_id, direction, from_number, body, related_entity_type, related_entity_id')
    .eq('provider_message_id', id1)
    .maybeSingle();
  record('Inbound resolved to the correct tenant', msg?.related_entity_id === mapping.entity_id,
    msg ? `entity=${msg.related_entity_type}` : 'no row created');
  record('Inbound attributed to the correct organisation', msg?.org_id === mapping.org_id, msg?.org_id ?? 'none');
  record('Inbound stored with direction=inbound and the sender number',
    msg?.direction === 'inbound' && msg?.from_number === UAT_NUMBER, `${msg?.direction} / ${msg?.from_number}`);
  record('Inbound message body preserved', msg?.body === 'UAT inbound test message', msg?.body ?? 'none');

  // 2. Duplicate / replay of the same provider event must not create a second record.
  const r2 = await postWebhook(inboundPayload(UAT_NUMBER, 'UAT inbound test message', id1));
  record('Duplicate provider event answered 200 (no retry storm)', r2.status === 200, `HTTP ${r2.status}`);
  record('Duplicate reported alreadyProcessed', r2.json?.alreadyProcessed === true, String(r2.json?.alreadyProcessed));
  const { count: dupCount } = await admin
    .from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('provider_message_id', id1);
  record('Replay created no duplicate application record', dupCount === 1, `${dupCount} row(s)`);

  // 3. Invalid signature must be refused outright.
  const badPayload = inboundPayload(UAT_NUMBER, 'should never be stored', `wamid.bad-${crypto.randomUUID()}`);
  const badRaw = JSON.stringify(badPayload);
  const r3 = await postWebhook(badPayload, { signature: sign(badRaw, 'wrong-secret') });
  record('Invalid signature rejected with 401', r3.status === 401, `HTTP ${r3.status}`);
  const badId = badPayload.entry[0].changes[0].value.messages[0].id;
  const { count: badCount } = await admin
    .from('whatsapp_webhook_events').select('id', { count: 'exact', head: true }).eq('provider_event_id', badId);
  record('Nothing stored for an unsigned/forged request', (badCount ?? 0) === 0, `${badCount ?? 0} row(s)`);

  // 4. Malformed payload.
  const malformedRaw = '{not valid json';
  const r4 = await postWebhook(null, { raw: malformedRaw, signature: sign(malformedRaw) });
  record('Malformed payload answered 400 (not a 5xx retry loop)', r4.status === 400, `HTTP ${r4.status}`);

  // 5. Unknown number must not attach to any tenant.
  const id5 = `wamid.unknown-${crypto.randomUUID()}`;
  createdIds.push(id5);
  const r5 = await postWebhook(inboundPayload('+27999888777', 'from a stranger', id5));
  record('Unknown number accepted without error', r5.status === 200, `HTTP ${r5.status}`);
  const { data: ev5 } = await admin
    .from('whatsapp_webhook_events').select('org_id').eq('provider_event_id', id5).maybeSingle();
  record('Unknown number attached to NO organisation', ev5 !== null && ev5.org_id === null, `org=${ev5?.org_id ?? 'null'}`);
  const { count: unknownMsgs } = await admin
    .from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('provider_message_id', id5);
  record('Unknown number created no org-scoped message row', unknownMsgs === 0, `${unknownMsgs} row(s)`);

  // 6. Cross-org: the UAT number must never resolve into any other organisation.
  const { data: otherOrgMsgs } = await admin
    .from('whatsapp_messages')
    .select('org_id')
    .eq('provider_message_id', id1);
  const leakedToOtherOrg = (otherOrgMsgs ?? []).some((m) => m.org_id !== mapping.org_id);
  record('No cross-organisation leakage for the resolved message', !leakedToOtherOrg,
    `orgs=${[...new Set((otherOrgMsgs ?? []).map((m) => m.org_id))].length}`);

  // Cleanup the probe's own rows so repeated runs stay clean.
  for (const id of createdIds) {
    await admin.from('whatsapp_messages').delete().eq('provider_message_id', id);
    await admin.from('whatsapp_webhook_events').delete().eq('provider_event_id', id);
  }
  console.log('\n(cleanup: probe webhook events and messages removed)');

  const failed = results.filter((r) => !r.passed);
  console.log(`\n=== INBOUND UAT: ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length) {
    console.log('FAILURES:');
    for (const f of failed) console.log(`  - ${f.name} (${f.detail})`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
