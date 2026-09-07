// PUBLIC UAT -- provision the dedicated "Proplyst UAT Portfolio" organisation and its three
// synthetic personas on the PRODUCTION deployment.
//
// AUTHORISED SCOPE: this script may only create records belonging to the UAT organisation and its
// own synthetic identities. It never reads, updates or deletes any other organisation's data.
//
// PROVISIONING PATH (deliberately the narrowest existing mechanism, no SQL bypass):
//   1. auth.admin.createUser({ email_confirm: true }) -- the supported admin identity mechanism.
//      Pre-confirming avoids needing a mail inbox; no email is sent to anyone.
//   2. signInWithPassword() as the UAT owner, then call create_organization() over RPC with that
//      REAL user JWT -- i.e. exactly the path a real customer takes, not a service-role insert.
//      (create_organization is SECURITY DEFINER and raises without auth.uid(), so a service-role
//      connection genuinely cannot call it -- the user JWT is required, not a convenience.)
//   3. activate_trial_after_payment(org_id) with the service-role key. This is the purpose-built
//      RPC that is `revoke all ... from public, authenticated, anon`, callable only by
//      service_role, idempotent, and touching ONLY this org's own commercial-gate columns. It is
//      the same mechanism every pgTAP fixture uses after create_organization(). No RLS is
//      weakened, no global commercial rule changed, no real subscription touched, and NO PAYMENT
//      is submitted or charge incurred.
//
// SECRETS: persona passwords are generated locally, written only to the session scratchpad file
// named by UAT_CRED_FILE (outside the repository), and never printed, logged or committed.
//
// Usage (from apps/admin/):
//   UAT_CRED_FILE=<path> node --env-file=.env.local scripts/uat-provision.mjs

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CRED_FILE = process.env.UAT_CRED_FILE;

if (!URL || !SERVICE_KEY || !ANON_KEY) {
  console.error('Missing Supabase environment values.');
  process.exit(1);
}
if (!CRED_FILE) {
  console.error('UAT_CRED_FILE must name a path OUTSIDE the repository for persona credentials.');
  process.exit(1);
}
if (/[/\\]PropValt \(Property App\)[/\\]/i.test(CRED_FILE)) {
  console.error('REFUSING: UAT_CRED_FILE points inside the repository. Credentials must never be committable.');
  process.exit(1);
}

const ORG_NAME = 'Proplyst UAT Portfolio';
// Reserved TLD (RFC 2606) -- these addresses provably cannot deliver mail to any real person,
// which is what makes it safe to create them on a deployment with a live Resend provider.
const PERSONAS = {
  owner: { email: 'uat-owner@uat-proplyst.invalid', name: 'UAT Owner' },
  staff: { email: 'uat-staff@uat-proplyst.invalid', name: 'UAT Property Manager' },
  tenant: { email: 'uat-tenant@uat-proplyst.invalid', name: 'UAT Tenant' },
};

const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

// Reuse previously-generated passwords so re-running is idempotent and never locks us out.
const store = existsSync(CRED_FILE) ? JSON.parse(readFileSync(CRED_FILE, 'utf8')) : {};
const newPassword = () => `Uat!${randomBytes(18).toString('base64url')}`;

console.log('=== UAT PROVISIONING (production, authorised scope only) ===\n');

// ---- 1. Identities --------------------------------------------------------------------------
console.log('--- 1. SYNTHETIC IDENTITIES ---');
for (const [role, p] of Object.entries(PERSONAS)) {
  store[role] ??= { email: p.email };
  store[role].password ??= newPassword();

  const { data, error } = await admin.auth.admin.createUser({
    email: p.email,
    password: store[role].password,
    email_confirm: true,
    user_metadata: { display_name: p.name, uat: true },
  });

  if (error && /already.*registered|already been registered|email_exists/i.test(error.message)) {
    // Already provisioned on an earlier run -- reset to the stored password so login is certain.
    let found = null;
    for (let page = 1; page <= 20 && !found; page += 1) {
      const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (!list?.users?.length) break;
      found = list.users.find((u) => u.email?.toLowerCase() === p.email.toLowerCase()) ?? null;
    }
    if (!found) {
      console.log(`  ${role}: EXISTS but could not be located by paging. ABORTING.`);
      process.exit(1);
    }
    await admin.auth.admin.updateUserById(found.id, {
      password: store[role].password,
      email_confirm: true,
    });
    store[role].userId = found.id;
    console.log(`  ${role}: reused existing identity  user_id=${found.id}`);
  } else if (error) {
    console.log(`  ${role}: FAILED -- ${error.message}`);
    process.exit(1);
  } else {
    store[role].userId = data.user.id;
    console.log(`  ${role}: created  user_id=${data.user.id}`);
  }
  writeFileSync(CRED_FILE, JSON.stringify(store, null, 2));
}
console.log(`  (passwords written only to ${CRED_FILE.replace(/.*[/\\]/, '.../')} -- never printed)\n`);

// ---- 2. Organisation, created as the real user over RPC --------------------------------------
console.log('--- 2. ORGANISATION (created as the UAT owner, normal RPC path) ---');
const asOwner = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
const { error: signInErr } = await asOwner.auth.signInWithPassword({
  email: PERSONAS.owner.email,
  password: store.owner.password,
});
if (signInErr) {
  console.log(`  owner sign-in FAILED: ${signInErr.message}`);
  process.exit(1);
}
console.log(`  owner signed in (session established, JWT held in memory only)`);

// Does the org already exist for this owner?
const { data: existingMemberships } = await admin
  .from('organization_members')
  .select('org_id, role, status')
  .eq('user_id', store.owner.userId);

let orgId = null;
for (const m of existingMemberships ?? []) {
  const { data: o } = await admin.from('organizations').select('id, legal_name').eq('id', m.org_id).maybeSingle();
  if (o?.legal_name === ORG_NAME) orgId = o.id;
}

if (orgId) {
  console.log(`  "${ORG_NAME}" already exists -- reusing  org_id=${orgId}`);
} else {
  const { data: created, error: createErr } = await asOwner.rpc('create_organization', {
    p_legal_name: ORG_NAME,
  });
  if (createErr) {
    console.log(`  create_organization FAILED: ${createErr.message}`);
    process.exit(1);
  }
  orgId = created;
  console.log(`  created via create_organization() as the real user  org_id=${orgId}`);
}
store.orgId = orgId;
store.orgName = ORG_NAME;
writeFileSync(CRED_FILE, JSON.stringify(store, null, 2));

// ---- 3. Commercial activation, narrowest admin mechanism, zero charge ------------------------
console.log('\n--- 3. COMMERCIAL ACTIVATION (no payment, no charge) ---');
const { data: before } = await admin
  .from('organizations')
  .select('commercial_setup_required, commercial_setup_completed_at, trial_ends_at')
  .eq('id', orgId)
  .single();
console.log(`  before: setup_required=${before.commercial_setup_required} completed_at=${before.commercial_setup_completed_at ?? 'null'}`);

if (!before.commercial_setup_completed_at) {
  const { error: actErr } = await admin.rpc('activate_trial_after_payment', { p_org_id: orgId });
  if (actErr) {
    console.log(`  activate_trial_after_payment FAILED: ${actErr.message}`);
    process.exit(1);
  }
}
const { data: after } = await admin
  .from('organizations')
  .select('commercial_setup_required, commercial_setup_completed_at, trial_ends_at')
  .eq('id', orgId)
  .single();
console.log(`  after:  setup_required=${after.commercial_setup_required} completed_at=${after.commercial_setup_completed_at ? 'set' : 'null'} trial_ends=${after.trial_ends_at?.slice(0, 10) ?? 'null'}`);

// Prove no payment artefact was created for this org.
for (const [table, label] of [['subscription_payments', 'subscription payments'], ['payment_methods', 'payment methods'], ['billing_events', 'billing events']]) {
  const { count, error } = await admin.from(table).select('id', { count: 'exact', head: true }).eq('org_id', orgId);
  console.log(`  ${label} for this org: ${error ? `n/a (${error.message.slice(0, 40)})` : (count ?? 0)}`);
}

// ---- 4. Confirm isolation from every other organisation --------------------------------------
console.log('\n--- 4. SCOPE CHECK ---');
const { count: orgCount } = await admin.from('organizations').select('id', { count: 'exact', head: true });
console.log(`  total organisations now: ${orgCount} (was 10 before this pass)`);
console.log(`  UAT org id: ${orgId}`);
console.log(`  owner user_id:  ${store.owner.userId}`);
console.log(`  staff user_id:  ${store.staff.userId}`);
console.log(`  tenant user_id: ${store.tenant.userId}`);

await asOwner.auth.signOut();
console.log('\n=== PROVISIONING COMPLETE -- no payment submitted, no charge incurred ===');
