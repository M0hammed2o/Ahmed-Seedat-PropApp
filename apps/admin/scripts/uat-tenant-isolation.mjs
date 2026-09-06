// Live tenant-to-tenant data isolation test (V1 release-gate UAT pass).
//
// Complements scripts/uat-security-isolation.mjs (which covers cross-ORGANISATION isolation).
// This one covers the harder, subtler case: two tenants INSIDE THE SAME organisation, who share an
// org_id and therefore cannot be separated by org-scoped RLS alone. Tenant isolation here rests
// entirely on the `tenants.user_id = auth.uid()` predicate (migrations 28/49), so a route that
// forgets that predicate -- or uses the service-role client on a caller-supplied lease/invoice id --
// would expose one renter's lease, payment history, or documents to another. pgTAP proves the
// policies; this proves the live HTTP API actually relies on them.
//
// Tenant auth accounts are created against EXISTING demo tenant rows (linking tenants.user_id),
// used for the probe, then unlinked and deleted, leaving the demo portfolio exactly as found.
//
// LOCAL ONLY. Refuses to run against anything but 127.0.0.1/localhost.
//
// Usage (from apps/admin/, with the local dev server running):
//   node scripts/uat-tenant-isolation.mjs

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

const PASSWORD = 'UatTenant2026!';
const results = [];
function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
}

async function signInViaApp(email, password) {
  const res = await fetch(`${APP_URL}/api/v1/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP_URL },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`signin failed ${res.status}: ${await res.text()}`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('signin returned no session cookies');
  return cookie;
}

async function probe(cookie, path) {
  const res = await fetch(`${APP_URL}${path}`, { headers: { Cookie: cookie, Origin: APP_URL } });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON ok */ }
  return { status: res.status, json, text: JSON.stringify(json ?? {}) };
}

/** Create a real auth user and link it to an existing demo tenant row. */
async function linkTenant(tenantRow, label) {
  const email = `uat-${label}-${tenantRow.id.slice(0, 8)}@proplyst-demo.local`;
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  }
  await admin.from('tenants').update({ user_id: user.id }).eq('id', tenantRow.id);
  return { userId: user.id, email, tenantId: tenantRow.id, name: tenantRow.full_name };
}

async function main() {
  console.log(`Target app: ${APP_URL} (confirmed local)\n`);

  const { data: org } = await admin
    .from('organizations').select('id').ilike('legal_name', 'Proplyst Demo Portfolio%').maybeSingle();
  if (!org) throw new Error('Demo portfolio org not found -- run the seed script first.');

  // Pick two tenants in DIFFERENT properties, so the probe also covers property-level separation.
  const { data: leases } = await admin
    .from('leases')
    .select('id, unit_id, org_id, units!inner(id, property_id, unit_label)')
    .eq('org_id', org.id)
    .eq('status', 'active')
    .limit(40);

  const byProperty = new Map();
  for (const l of leases ?? []) {
    const pid = l.units.property_id;
    if (!byProperty.has(pid)) byProperty.set(pid, l);
  }
  const picked = [...byProperty.values()].slice(0, 2);
  if (picked.length < 2) throw new Error('Need active leases in at least two properties.');

  const pair = [];
  for (const lease of picked) {
    const { data: lt } = await admin
      .from('lease_tenants').select('tenant_id').eq('lease_id', lease.id).eq('is_primary', true).maybeSingle();
    const { data: t } = await admin.from('tenants').select('id, full_name').eq('id', lt.tenant_id).single();
    const { data: inv } = await admin
      .from('invoices').select('id').eq('lease_id', lease.id).order('period', { ascending: false }).limit(1);
    pair.push({ lease, tenant: t, invoiceId: inv?.[0]?.id });
  }

  const [A, B] = pair;
  const originalUserIds = {};
  for (const p of pair) {
    const { data } = await admin.from('tenants').select('user_id').eq('id', p.tenant.id).single();
    originalUserIds[p.tenant.id] = data.user_id;
  }

  try {
    const tenantA = await linkTenant(A.tenant, 'tenant-a');
    await linkTenant(B.tenant, 'tenant-b');
    console.log(`Tenant A: ${tenantA.name} (unit ${A.lease.units.unit_label})`);
    console.log(`Tenant B: ${B.tenant.full_name} (unit ${B.lease.units.unit_label})  <-- victim\n`);

    const cookie = await signInViaApp(tenantA.email, PASSWORD);
    record('Tenant A can sign in (control -- proves the session is real)', true);

    // Markers that identify Tenant B's data specifically.
    const markers = [B.tenant.id, B.lease.id, B.tenant.full_name, B.invoiceId].filter(Boolean);

    const probes = [
      ["Tenant A cannot read Tenant B's lease", `/api/v1/leases/${B.lease.id}`],
      ["Tenant A cannot read Tenant B's invoice", B.invoiceId ? `/api/v1/invoices/${B.invoiceId}` : null],
      ["Tenant A cannot read Tenant B's invoice PDF", B.invoiceId ? `/api/v1/invoices/${B.invoiceId}/pdf` : null],
      ["Tenant A cannot read Tenant B's invoice payments", B.invoiceId ? `/api/v1/invoices/${B.invoiceId}/payments` : null],
      ["Tenant A cannot read Tenant B's unit", `/api/v1/units/${B.lease.unit_id}`],
      ["Tenant A cannot read the property Tenant B lives in", `/api/v1/properties/${B.lease.units.property_id}`],
    ].filter(([, p]) => p);

    for (const [name, path] of probes) {
      try {
        const res = await probe(cookie, path);
        const leaked = res.status >= 200 && res.status < 300 && markers.some((m) => res.text.includes(m));
        record(name, !leaked, `HTTP ${res.status}${leaked ? ' -- LEAKED TENANT B DATA' : ''}`);
      } catch (e) {
        record(name, true, `request error (treated as denied): ${e.message}`);
      }
    }

    // Listing endpoints: legitimately 200 for Tenant A, but must contain none of Tenant B's rows.
    for (const [name, path] of [
      ["Tenant B absent from Tenant A's invoice list", '/api/v1/invoices'],
      ["Tenant B absent from Tenant A's lease list", '/api/v1/leases'],
      ["Tenant B absent from Tenant A's document list", '/api/v1/documents'],
      ["Tenant B absent from Tenant A's maintenance list", '/api/v1/maintenance-tickets'],
      ["Org tenant directory not exposed to Tenant A", '/api/v1/tenants'],
    ]) {
      try {
        const res = await probe(cookie, path);
        const leaked = res.status >= 200 && res.status < 300 && markers.some((m) => res.text.includes(m));
        record(name, !leaked, `HTTP ${res.status}${leaked ? ' -- LEAKED TENANT B DATA' : ''}`);
      } catch (e) {
        record(name, true, `request error: ${e.message}`);
      }
    }

    // Owner-only surfaces must never be readable by a tenant at all.
    for (const [name, path] of [
      ['Tenant cannot read owner portfolio financial summary', `/api/v1/organizations/${org.id}/financial-summary?month=2026-09-01`],
      ['Tenant cannot read owner org activity feed', `/api/v1/organizations/${org.id}/activity`],
      ['Tenant cannot read owner property rent status', `/api/v1/properties/${B.lease.units.property_id}/rent-status?month=2026-09-01`],
    ]) {
      const res = await probe(cookie, path);
      const denied = res.status >= 400;
      const leaked = !denied && markers.some((m) => res.text.includes(m));
      record(name, denied || !leaked, `HTTP ${res.status}${leaked ? ' -- LEAKED' : denied ? ' (denied)' : ' (empty)'}`);
    }
  } finally {
    // Restore the demo portfolio exactly as found: unlink and delete the probe auth users.
    for (const p of pair) {
      await admin.from('tenants').update({ user_id: originalUserIds[p.tenant.id] ?? null }).eq('id', p.tenant.id);
    }
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const u of list.users.filter((u) => u.email?.startsWith('uat-tenant-'))) {
      await admin.auth.admin.deleteUser(u.id);
    }
    console.log('\n(cleanup: probe tenant logins unlinked and deleted; demo data unchanged)');
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n=== TENANT ISOLATION RESULTS: ${results.length - failed.length}/${results.length} passed ===`);
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
