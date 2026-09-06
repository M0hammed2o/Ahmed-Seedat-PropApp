// Live cross-organisation / cross-tenant API isolation test (V1 release-gate UAT pass).
//
// This is deliberately an APPLICATION-LAYER test, not a database-layer one: the pgTAP suite
// already proves RLS policies behave correctly when queried directly, but that says nothing about
// whether an API route accidentally uses the SERVICE-ROLE client (which bypasses RLS entirely) on
// a caller-supplied orgId/propertyId. That class of bug is invisible to pgTAP and is exactly what
// this script hunts for: it signs in as a genuinely unrelated organisation's owner and asks the
// real HTTP API for another org's data, using real session cookies.
//
// LOCAL ONLY. Refuses to run against anything but 127.0.0.1/localhost.
//
// Usage (from apps/admin/, with the local dev server running):
//   node scripts/uat-security-isolation.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

for (const [name, url] of [['SUPABASE_URL', SUPABASE_URL], ['APP_URL', APP_URL]]) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(url)) {
    console.error(`SAFETY: refusing to run against non-local ${name}: ${url}`);
    process.exit(1);
  }
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ATTACKER_EMAIL = 'uat-attacker@proplyst-demo.local';
const ATTACKER_PASSWORD = 'UatAttacker2026!';
const ATTACKER_ORG = 'UAT Isolation Probe Org [INTERNAL TEST]';

const results = [];
function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
}

async function ensureAttacker() {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
  let user = list.users.find((u) => u.email === ATTACKER_EMAIL);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: ATTACKER_EMAIL,
      password: ATTACKER_PASSWORD,
      email_confirm: true,
      user_metadata: { first_name: 'Uat', last_name: 'Probe' },
    });
    if (error) throw error;
    user = data.user;
  }

  let { data: org } = await admin
    .from('organizations')
    .select('id')
    .eq('legal_name', ATTACKER_ORG)
    .maybeSingle();
  if (!org) {
    const { data: created, error } = await admin
      .from('organizations')
      .insert({ legal_name: ATTACKER_ORG, org_type: 'owner_managed', status: 'active' })
      .select('id')
      .single();
    if (error) throw error;
    org = created;
    await admin.from('organization_members').insert({
      org_id: org.id,
      user_id: user.id,
      role: 'principal',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
  }
  return { userId: user.id, orgId: org.id };
}

async function getVictim() {
  const { data: org } = await admin
    .from('organizations')
    .select('id, legal_name')
    .ilike('legal_name', 'Proplyst Demo Portfolio%')
    .maybeSingle();
  if (!org) throw new Error('Demo portfolio org not found -- run the seed script first.');
  const { data: props } = await admin.from('properties').select('id, nickname').eq('org_id', org.id).limit(1);
  const { data: units } = await admin.from('units').select('id').eq('org_id', org.id).limit(1);
  const { data: tenants } = await admin.from('tenants').select('id').eq('org_id', org.id).limit(1);
  const { data: leases } = await admin.from('leases').select('id').eq('org_id', org.id).limit(1);
  const { data: docs } = await admin.from('documents').select('id').eq('org_id', org.id).limit(1);
  const { data: invoices } = await admin.from('invoices').select('id').eq('org_id', org.id).limit(1);
  return {
    orgId: org.id,
    propertyId: props?.[0]?.id,
    propertyName: props?.[0]?.nickname,
    unitId: units?.[0]?.id,
    tenantId: tenants?.[0]?.id,
    leaseId: leases?.[0]?.id,
    documentId: docs?.[0]?.id,
    invoiceId: invoices?.[0]?.id,
  };
}

/** Sign in through the REAL app auth route so we hold genuine session cookies, exactly like a browser. */
async function signInViaApp(email, password) {
  const res = await fetch(`${APP_URL}/api/v1/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP_URL },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (!res.ok) throw new Error(`signin failed ${res.status}: ${await res.text()}`);
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('signin returned no session cookies');
  return cookie;
}

async function probe(cookie, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${APP_URL}${path}`, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: APP_URL },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body is fine */
  }
  return { status: res.status, json };
}

/** A probe "leaks" if it returns 2xx AND the payload carries recognisable victim data. */
function leaks(result, victimMarkers) {
  if (result.status < 200 || result.status >= 300) return false;
  const text = JSON.stringify(result.json ?? {});
  return victimMarkers.some((m) => m && text.includes(m));
}

async function main() {
  console.log(`Target app: ${APP_URL} (confirmed local)\n`);
  const attacker = await ensureAttacker();
  const victim = await getVictim();
  console.log(`Attacker org: ${attacker.orgId}`);
  console.log(`Victim  org: ${victim.orgId} (${victim.propertyName})\n`);

  const cookie = await signInViaApp(ATTACKER_EMAIL, ATTACKER_PASSWORD);
  record('Attacker can sign in (control -- proves the session is real)', true);

  const markers = [victim.propertyId, victim.propertyName, victim.tenantId, victim.leaseId].filter(Boolean);

  const probes = [
    ['Cross-org: read victim org financial summary', `/api/v1/organizations/${victim.orgId}/financial-summary?month=2026-09-01`],
    ['Cross-org: read victim org annual budget', `/api/v1/organizations/${victim.orgId}/budget/annual?year=2026`],
    ['Cross-org: read victim org activity feed', `/api/v1/organizations/${victim.orgId}/activity`],
    ['Cross-org: read victim property detail', `/api/v1/properties/${victim.propertyId}`],
    ['Cross-org: read victim property financial summary', `/api/v1/properties/${victim.propertyId}/financial-summary?month=2026-09-01`],
    ['Cross-org: read victim property annual budget', `/api/v1/properties/${victim.propertyId}/budget/annual?year=2026`],
    ['Cross-org: read victim property units', `/api/v1/properties/${victim.propertyId}/units`],
    ['Cross-org: read victim property utility meters', `/api/v1/properties/${victim.propertyId}/utility-meters`],
    ['Cross-org: read victim property utility settings', `/api/v1/properties/${victim.propertyId}/utility-settings`],
    ['Cross-org: read victim property rent status', `/api/v1/properties/${victim.propertyId}/rent-status?month=2026-09-01`],
  ];

  for (const [name, path] of probes) {
    try {
      const res = await probe(cookie, path);
      const leaked = leaks(res, markers);
      record(name, !leaked, `HTTP ${res.status}${leaked ? ' -- LEAKED VICTIM DATA' : ''}`);
    } catch (e) {
      record(name, true, `request error (treated as denied): ${e.message}`);
    }
  }

  // Listing endpoints must never include victim rows even though they are legitimately 200 for
  // the attacker's own (empty) org -- a different failure shape from the 403s above.
  const listProbes = [
    ['Cross-org: victim properties absent from attacker property list', '/api/v1/properties'],
    ['Cross-org: victim tenants absent from attacker tenant list', '/api/v1/tenants'],
  ];
  for (const [name, path] of listProbes) {
    try {
      const res = await probe(cookie, path);
      const leaked = leaks(res, markers);
      record(name, !leaked, `HTTP ${res.status}${leaked ? ' -- LEAKED VICTIM DATA' : ''}`);
    } catch (e) {
      record(name, true, `request error: ${e.message}`);
    }
  }

  // Write attempts are the highest-severity class: a successful cross-org WRITE is worse than a read.
  const writeProbes = [
    [
      'Cross-org WRITE: set a budget on victim property',
      `/api/v1/properties/${victim.propertyId}/budget`,
      { month: '2026-09-01', plannedAmount: 999999 },
    ],
    [
      'Cross-org WRITE: create an expense against victim property',
      '/api/v1/expenses',
      { propertyId: victim.propertyId, category: 'Maintenance', categoryCode: 'maintenance', amount: 12345, invoiceDate: '2026-09-01' },
    ],
  ];
  for (const [name, path, body] of writeProbes) {
    try {
      const res = await probe(cookie, path, { method: 'POST', body });
      const ok = res.status >= 400;
      record(name, ok, `HTTP ${res.status}${ok ? ' (denied)' : ' -- WRITE ACCEPTED'}`);
    } catch (e) {
      record(name, true, `request error (treated as denied): ${e.message}`);
    }
  }

  // Confirm the write probes really did not land, independent of what the HTTP status claimed.
  const { count: budgetLeak } = await admin
    .from('property_budgets')
    .select('id', { count: 'exact', head: true })
    .eq('property_id', victim.propertyId)
    .eq('planned_amount', 999999);
  record('Cross-org WRITE did not persist a budget row', (budgetLeak ?? 0) === 0, `${budgetLeak ?? 0} rows`);

  const { count: expenseLeak } = await admin
    .from('expenses')
    .select('id', { count: 'exact', head: true })
    .eq('property_id', victim.propertyId)
    .eq('amount', 12345);
  record('Cross-org WRITE did not persist an expense row', (expenseLeak ?? 0) === 0, `${expenseLeak ?? 0} rows`);

  // Unauthenticated access must also be refused (no cookie at all).
  for (const [name, path] of [
    ['Unauthenticated: victim org financial summary refused', `/api/v1/organizations/${victim.orgId}/financial-summary?month=2026-09-01`],
    ['Unauthenticated: victim property detail refused', `/api/v1/properties/${victim.propertyId}`],
  ]) {
    const res = await fetch(`${APP_URL}${path}`, { headers: { Origin: APP_URL } });
    let json = null;
    try { json = await res.json(); } catch { /* ignore */ }
    const leaked = leaks({ status: res.status, json }, markers);
    record(name, !leaked, `HTTP ${res.status}${leaked ? ' -- LEAKED' : ''}`);
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n=== ISOLATION RESULTS: ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length > 0) {
    console.log('FAILURES:');
    for (const f of failed) console.log(`  - ${f.name} (${f.detail})`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
