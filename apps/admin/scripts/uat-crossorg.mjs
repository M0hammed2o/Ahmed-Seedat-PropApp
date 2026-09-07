// PUBLIC UAT -- cross-organisation isolation between two synthetic UAT organisations.
//
// Creates "Proplyst UAT Isolation Portfolio" with its own owner, using the identical approved
// provisioning path as the first org, then attempts Org A <-> Org B id/URL/API substitution in
// both directions. Neither org may ever see the other's data.
//
// Only the minimum data needed for isolation testing is created. No real organisation is touched.


import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { launch, signIn, path, bodyText, BASE } from './uat-browser-lib.mjs';

const CRED = process.env.UAT_CRED_FILE;
const store = JSON.parse(readFileSync(CRED, 'utf8'));
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const ORG_B_NAME = 'Proplyst UAT Isolation Portfolio';
const results = [];
let pass = 0;
let fail = 0;
function record(action, expected, actual, ok, note = '') {
  results.push({ action, expected, actual, ok, note });
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${action} -> ${actual}`);
  if (!ok) console.log(`        expected: ${expected} ${note}`);
}

// ---- Provision org B, same mechanism as org A -------------------------------------------------
console.log('=== PROVISION ORG B ===');
store.ownerB ??= { email: 'uat-owner-b@uat-proplyst.invalid' };
store.ownerB.password ??= `Uat!${randomBytes(18).toString('base64url')}`;

const { data: created, error: cErr } = await admin.auth.admin.createUser({
  email: store.ownerB.email, password: store.ownerB.password, email_confirm: true,
  user_metadata: { display_name: 'UAT Owner B', uat: true },
});
if (cErr && /already/i.test(cErr.message)) {
  for (let p = 1; p <= 20; p += 1) {
    const { data: list } = await admin.auth.admin.listUsers({ page: p, perPage: 200 });
    if (!list?.users?.length) break;
    const f = list.users.find((u) => u.email?.toLowerCase() === store.ownerB.email.toLowerCase());
    if (f) { store.ownerB.userId = f.id; await admin.auth.admin.updateUserById(f.id, { password: store.ownerB.password, email_confirm: true }); break; }
  }
  console.log('  owner B reused');
} else if (cErr) { console.log(`  FAILED: ${cErr.message}`); process.exit(1); }
else { store.ownerB.userId = created.user.id; console.log('  owner B created'); }
writeFileSync(CRED, JSON.stringify(store, null, 2));

const asB = createClient(URL_, ANON, { auth: { persistSession: false } });
const { error: sErr } = await asB.auth.signInWithPassword({ email: store.ownerB.email, password: store.ownerB.password });
if (sErr) { console.log(`  sign-in failed: ${sErr.message}`); process.exit(1); }

const { data: memb } = await admin.from('organization_members').select('org_id').eq('user_id', store.ownerB.userId);
let orgB = null;
for (const m of memb ?? []) {
  const { data: o } = await admin.from('organizations').select('id,legal_name').eq('id', m.org_id).maybeSingle();
  if (o?.legal_name === ORG_B_NAME) orgB = o.id;
}
if (!orgB) {
  const { data: newOrg, error: oErr } = await asB.rpc('create_organization', { p_legal_name: ORG_B_NAME });
  if (oErr) { console.log(`  create_organization failed: ${oErr.message}`); process.exit(1); }
  orgB = newOrg;
  await admin.rpc('activate_trial_after_payment', { p_org_id: orgB });
  console.log(`  org B created: ${orgB}`);
} else console.log(`  org B reused: ${orgB}`);
store.orgIdB = orgB;
writeFileSync(CRED, JSON.stringify(store, null, 2));

// ---- Browser: org B owner tries to reach org A, and vice versa ---------------------------------
const ORG_A = store.orgId;
const SEASIDE = '792ed2e3-63f5-4e82-b1fc-efd465cf8e9a';

const browser = await launch();

// Org A owner collects real ids; also create one property in B so B has data of its own.
const a = await signIn(browser, 'owner');
const aLeases = JSON.parse(await (await a.page.request.get(`${BASE}/api/v1/leases`, { failOnStatusCode: false })).text());
const aLeaseId = aLeases.leases?.[0]?.id;
const aTenants = JSON.parse(await (await a.page.request.get(`${BASE}/api/v1/tenants`, { failOnStatusCode: false })).text());
const aTenantId = aTenants.tenants?.[0]?.id;

// Sign in as B through the PUBLIC app.
const b = await signIn(browser, 'ownerB');
console.log(`\n=== ORG B OWNER -> ORG A DATA (landed ${path(b.page)}) ===`);

const A_TARGETS = [
  ['org A property', `/api/v1/properties/${SEASIDE}`],
  ['org A units', `/api/v1/properties/${SEASIDE}/units`],
  ['org A lease', `/api/v1/leases/${aLeaseId}`],
  ['org A tenant', `/api/v1/tenants/${aTenantId}`],
  ['org A members', `/api/v1/organizations/${ORG_A}/members`],
  ['org A expenses', `/api/v1/expenses?orgId=${ORG_A}`],
];
const leaksA = (s) => s.includes(SEASIDE) || s.includes('UAT Seaside') || s.includes('Naledi Khumalo')
  || s.includes('Craig Williams') || (aLeaseId && s.includes(aLeaseId));

for (const [label, url] of A_TARGETS) {
  const r = await b.page.request.get(`${BASE}${url}`, { failOnStatusCode: false });
  const body = (await r.text()).slice(0, 4000);
  const exposed = leaksA(body);
  record(`B reads ${label}`, 'refused or empty, never org A data',
    `HTTP ${r.status()}${exposed ? ' -- LEAKED ORG A DATA' : ' -- clean'}`, !exposed,
    exposed ? 'CRITICAL cross-org exposure' : '');
}
for (const url of ['/dashboard', '/properties', `/properties/${SEASIDE}`, '/tenants', '/leases']) {
  await b.page.goto(`${BASE}${url}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  const t = await bodyText(b.page);
  const exposed = leaksA(t);
  record(`B opens ${url}`, 'never renders org A data',
    `${path(b.page)}${exposed ? ' -- LEAKED' : ' -- clean'}`, !exposed,
    exposed ? 'CRITICAL cross-org exposure' : '');
}

// Reverse direction: A must not see B.
console.log(`\n=== ORG A OWNER -> ORG B DATA ===`);
for (const [label, url] of [['org B members', `/api/v1/organizations/${orgB}/members`],
  ['org B expenses', `/api/v1/expenses?orgId=${orgB}`],
  ['org B billing', `/api/v1/organizations/${orgB}/billing/quote`]]) {
  const r = await a.page.request.get(`${BASE}${url}`, { failOnStatusCode: false });
  const body = (await r.text()).slice(0, 3000);
  const exposed = body.includes(ORG_B_NAME) || body.includes(store.ownerB.email);
  record(`A reads ${label}`, 'refused, never org B data',
    `HTTP ${r.status()}${exposed ? ' -- LEAKED ORG B DATA' : ' -- clean'}`, !exposed,
    exposed ? 'CRITICAL cross-org exposure' : '');
}

console.log(`\n=== CROSS-ORG RESULT: ${pass}/${pass + fail} ===`);
for (const r of results.filter((x) => !x.ok)) console.log(`  FAIL: ${r.action} :: ${r.actual}`);
await browser.close();
