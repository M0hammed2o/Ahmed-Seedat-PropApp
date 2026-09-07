// PUBLIC UAT -- read-only production reconnaissance.
//
// Establishes the facts needed before any UAT provisioning decision: which organisations already
// exist (so no real customer org is ever touched), whether a UAT organisation is already present,
// and what the DEPLOYED external-communication providers actually are -- inferred from artefacts
// only a real provider can produce, since Render's runtime environment is not visible from here.
//
// STRICTLY READ-ONLY. No insert, update or delete anywhere. No secret value is ever printed.
//
// Usage (from apps/admin/):
//   node --env-file=.env.local scripts/uat-public-recon.mjs

import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(URL)) {
  console.error('REFUSING: this recon is for the production project, but the URL is local.');
  process.exit(1);
}

const db = createClient(URL, KEY, { auth: { persistSession: false } });
console.log(`=== PRODUCTION RECON (read-only) ===`);
console.log(`PROJECT: ${URL.replace(/https:\/\/([a-z0-9]{6})[a-z0-9]*/, 'https://$1...')}\n`);

// ---- Organisations -------------------------------------------------------------------------
const { data: orgs, error: orgErr } = await db
  .from('organizations')
  .select('id, legal_name, commercial_setup_required, commercial_setup_completed_at, created_at')
  .order('created_at', { ascending: true });

if (orgErr) {
  console.log(`organizations: ERROR ${orgErr.message}`);
} else {
  console.log(`--- ORGANISATIONS (${orgs.length}) ---`);
  for (const o of orgs) {
    const active = !o.commercial_setup_required || o.commercial_setup_completed_at;
    console.log(
      `  ${o.legal_name}\n     id=${o.id}  commercially_active=${active ? 'YES' : 'NO'}  created=${o.created_at?.slice(0, 10)}`,
    );
  }
  const uat = orgs.filter((o) => /uat/i.test(o.legal_name));
  console.log(`\n  Existing UAT-named organisations: ${uat.length ? uat.map((o) => o.legal_name).join(', ') : 'NONE'}`);
}

// ---- WhatsApp: is the DEPLOYED provider real? ----------------------------------------------
// A real Meta send returns a provider id shaped `wamid.*`. The mock returns a bare UUID. So the
// shape of ids already in production is direct evidence of which provider the deployment uses.
console.log('\n--- WHATSAPP (deployed provider, inferred from stored provider ids) ---');
const { data: wa, error: waErr } = await db
  .from('whatsapp_messages')
  .select('id, provider_message_id, status, template_name, created_at')
  .order('created_at', { ascending: false })
  .limit(20);

if (waErr) {
  console.log(`  whatsapp_messages: ERROR ${waErr.message}`);
} else if (!wa.length) {
  console.log('  0 rows in production. No WhatsApp message has ever been sent from the deployment.');
  console.log('  => Deployed provider CANNOT be determined from data alone.');
} else {
  const real = wa.filter((m) => (m.provider_message_id ?? '').startsWith('wamid.')).length;
  console.log(`  ${wa.length} most recent rows: ${real} carry a real Meta id (wamid.*), ${wa.length - real} do not.`);
  for (const m of wa.slice(0, 5)) {
    const shape = (m.provider_message_id ?? '').startsWith('wamid.') ? 'wamid.* (REAL META)' : 'uuid (MOCK)';
    console.log(`    ${m.created_at?.slice(0, 10)}  ${m.template_name}  status=${m.status}  id-shape=${shape}`);
  }
}

// ---- Email: is the DEPLOYED provider real? --------------------------------------------------
console.log('\n--- EMAIL (deployed provider, inferred from stored rows) ---');
const { data: em, error: emErr } = await db
  .from('email_messages')
  .select('id, provider_message_id, status, template_name, created_at')
  .order('created_at', { ascending: false })
  .limit(20);

if (emErr) {
  console.log(`  email_messages: ERROR ${emErr.message}`);
} else if (!em.length) {
  console.log('  0 rows in production.');
} else {
  const withProvider = em.filter((m) => m.provider_message_id).length;
  console.log(`  ${em.length} most recent rows: ${withProvider} carry a provider message id.`);
  const statuses = {};
  for (const m of em) statuses[m.status] = (statuses[m.status] ?? 0) + 1;
  console.log(`  statuses: ${JSON.stringify(statuses)}`);
  for (const m of em.slice(0, 5)) {
    console.log(`    ${m.created_at?.slice(0, 10)}  ${m.template_name}  status=${m.status}  provider_id=${m.provider_message_id ? 'present' : 'ABSENT'}`);
  }
}

// ---- Verified phone numbers (inbound WhatsApp mapping) --------------------------------------
console.log('\n--- VERIFIED PHONE NUMBERS (inbound mapping) ---');
const { count: vpnCount, error: vpnErr } = await db
  .from('verified_phone_numbers')
  .select('id', { count: 'exact', head: true });
console.log(vpnErr ? `  ERROR ${vpnErr.message}` : `  ${vpnCount ?? 0} row(s) in production.`);

// Confirm the UAT number is NOT already attached to any real tenant.
const UAT_NUMBER = '+27837866021';
const { count: tenantsWithUat } = await db
  .from('tenants')
  .select('id', { count: 'exact', head: true })
  .eq('phone', UAT_NUMBER);
console.log(`  Real tenant rows carrying the UAT number ${UAT_NUMBER}: ${tenantsWithUat ?? 0} (must stay 0)`);

console.log('\n=== RECON COMPLETE (nothing was written) ===');
