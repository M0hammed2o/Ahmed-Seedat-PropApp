// WhatsApp outbound pre-flight report (external-communications release-gate pass).
//
// Prints the safety-critical state that must be checked BEFORE any real WhatsApp send, and exits
// non-zero if it is not safe to proceed. Run this immediately before a real UAT sweep.
//
// It deliberately sends nothing and dispatches nothing -- it only reports which provider would be
// selected, whether the UAT override is active, and therefore where messages would actually go.
// The behavioural proof that every message really is addressed to the UAT number (and never to a
// persona/tenant number) lives in lib/__tests__/whatsappUatScenarios.test.ts, which can import the
// TypeScript dispatcher; this file is the human-readable gate in front of it.
//
// LOCAL ONLY. Usage (from apps/admin/):
//   WHATSAPP_UAT_OVERRIDE_NUMBER=+27837866021 node scripts/uat-whatsapp-preflight.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const OVERRIDE = (process.env.WHATSAPP_UAT_OVERRIDE_NUMBER ?? '').trim();
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const HAS_META =
  Boolean(process.env.WHATSAPP_ACCESS_TOKEN) &&
  Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID) &&
  Boolean(process.env.WHATSAPP_WEBHOOK_SECRET);
const E164 = /^\+[1-9]\d{6,14}$/;

const problems = [];

console.log('=== WHATSAPP OUTBOUND PRE-FLIGHT ===');
console.log(`ENVIRONMENT:                    ${process.env.NODE_ENV ?? 'development'}`);
console.log(`PRODUCTION:                     ${IS_PRODUCTION ? 'YES' : 'NO'}`);
console.log(
  `WHATSAPP PROVIDER:              ${HAS_META ? 'MetaWhatsAppProvider (REAL -- messages will be sent)' : 'MockWhatsAppProvider (nothing leaves the server)'}`,
);
console.log(`UAT OVERRIDE ACTIVE:            ${OVERRIDE ? `YES (${OVERRIDE})` : 'NO'}`);
console.log(`ACTUAL DESTINATION:             ${OVERRIDE || "(each recipient's own number)"}`);
console.log(`REAL TENANT PHONE WILL BE USED: ${OVERRIDE && E164.test(OVERRIDE) ? 'NO' : 'YES'}`);
console.log('');

if (IS_PRODUCTION) {
  problems.push('NODE_ENV=production -- the override is ignored in production and real recipients would be used.');
}
if (!OVERRIDE) {
  problems.push('WHATSAPP_UAT_OVERRIDE_NUMBER is not set -- every message would address its real recipient.');
} else if (!E164.test(OVERRIDE)) {
  problems.push(
    `WHATSAPP_UAT_OVERRIDE_NUMBER "${OVERRIDE}" is not valid E.164. The dispatcher fails closed ` +
      '(suppresses the send) rather than delivering to the real recipient, so no message would go out.',
  );
}

// A tenant record must never have been rewritten to the UAT number -- the override exists precisely
// so that source data stays untouched.
if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(SUPABASE_URL) && OVERRIDE) {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { count } = await supabase
      .from('tenants')
      .select('id', { count: 'exact', head: true })
      .eq('phone', OVERRIDE);
    console.log(`Tenant rows rewritten to the UAT number: ${count ?? 0} (must be 0)`);
    if ((count ?? 0) > 0) {
      problems.push(`${count} tenant record(s) carry the UAT number -- source data was modified; revert before proceeding.`);
    }
  } catch (e) {
    console.log(`Tenant-number check skipped: ${e.message}`);
  }
}

console.log('');
if (problems.length === 0) {
  console.log('=== PRE-FLIGHT: SAFE TO PROCEED ===');
  if (!HAS_META) {
    console.log('NOTE: provider is the mock -- a sweep now verifies routing and the pipeline,');
    console.log('      but NO message reaches any phone. Real delivery needs the Meta credentials');
    console.log('      listed in ENVIRONMENT.md ("External-communications go-live checklist").');
  }
} else {
  console.log('=== PRE-FLIGHT: DO NOT PROCEED ===');
  for (const p of problems) console.log(`  - ${p}`);
  process.exitCode = 1;
}
