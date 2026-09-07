// PUBLIC UAT -- authorisation testing against https://proplyst.co.za.
//
// The UAT staff and tenant identities exist but are NOT members of the UAT organisation. That
// makes them ideal negative-control principals: every request they make for the organisation's
// data is, by definition, a cross-account attempt that MUST fail. Hidden navigation is not
// security, so this drives the API directly by id substitution rather than clicking through a UI
// that simply would not show the links.

import { launch, signIn, path, bodyText, BASE } from './uat-browser-lib.mjs';
import { readFileSync } from 'node:fs';

const results = [];
let pass = 0;
let fail = 0;
function record(persona, target, expected, actual, ok, severity = '') {
  results.push({ persona, target, expected, actual, ok, severity });
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  [${persona}] ${target} -> ${actual}`);
  if (!ok) console.log(`        expected: ${expected}   ${severity}`);
}

const creds = JSON.parse(readFileSync(process.env.UAT_CRED_FILE, 'utf8'));
const ORG = creds.orgId;
const SEASIDE = '792ed2e3-63f5-4e82-b1fc-efd465cf8e9a';

const browser = await launch();

// Owner collects the real ids that the other personas will try to reach.
const owner = await signIn(browser, 'owner');
const leases = JSON.parse(await (await owner.page.request.get(`${BASE}/api/v1/leases`, { failOnStatusCode: false })).text());
const tenants = JSON.parse(await (await owner.page.request.get(`${BASE}/api/v1/tenants`, { failOnStatusCode: false })).text());
const leaseId = leases.leases?.[0]?.id;
const tenantId = tenants.tenants?.[0]?.id;
console.log(`\ntargets -- org=${ORG} property=${SEASIDE} lease=${leaseId} tenant=${tenantId}\n`);

// Endpoints that must never answer a non-member with data.
const API_TARGETS = [
  ['organisation list', `/api/v1/organizations`],
  ['property units', `/api/v1/properties/${SEASIDE}/units`],
  ['property detail', `/api/v1/properties/${SEASIDE}`],
  ['all leases', `/api/v1/leases`],
  ['specific lease', `/api/v1/leases/${leaseId}`],
  ['all tenants', `/api/v1/tenants`],
  ['specific tenant', `/api/v1/tenants/${tenantId}`],
  ['expenses', `/api/v1/expenses?orgId=${ORG}`],
  ['documents', `/api/v1/documents`],
  ['org members', `/api/v1/organizations/${ORG}/members`],
  ['org billing', `/api/v1/organizations/${ORG}/billing/quote`],
];

const PAGE_TARGETS = ['/dashboard', '/properties', `/properties/${SEASIDE}`, '/tenants', '/leases',
  '/accounting/expenses', '/budget', '/organization/staff', '/organization/billing', '/reports'];

// Does a response body actually contain this organisation's records?
function leaks(body) {
  return body.includes(SEASIDE) || body.includes('UAT Seaside') || body.includes('Naledi Khumalo')
    || body.includes('Sipho Ndlovu') || body.includes('Craig Williams') || (leaseId && body.includes(leaseId));
}

for (const persona of ['staff', 'tenant']) {
  console.log(`\n--- ${persona.toUpperCase()} (not a member of the UAT organisation) ---`);
  const s = await signIn(browser, persona, {});
  console.log(`  signed in, landed on ${path(s.page)}`);

  console.log(`  API (direct, id substitution):`);
  for (const [, url] of API_TARGETS) {
    const r = await s.page.request.get(`${BASE}${url}`, { failOnStatusCode: false });
    const body = (await r.text()).slice(0, 4000);
    const exposed = leaks(body);
    // Acceptable: refused outright, or an empty in-scope result. Never this org's records.
    const ok = !exposed;
    record(persona, `GET ${url}`, 'no records belonging to the UAT organisation',
      `HTTP ${r.status()}${exposed ? ' -- LEAKED ORG DATA' : ' -- no org data'}`, ok,
      exposed ? 'CRITICAL: cross-account data exposure' : '');
  }

  console.log(`  Pages (direct URL, not nav):`);
  for (const url of PAGE_TARGETS) {
    await s.page.goto(`${BASE}${url}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    const text = await bodyText(s.page);
    const exposed = leaks(text);
    record(persona, `PAGE ${url}`, 'does not render this organisation\'s data',
      `${path(s.page)}${exposed ? ' -- LEAKED ORG DATA' : ' -- no org data'}`, !exposed,
      exposed ? 'CRITICAL: cross-account data exposure' : '');
  }

  await s.ctx.close();
}

console.log(`\n=== SECURITY RESULT: ${pass}/${pass + fail} ===`);
const breaches = results.filter((r) => !r.ok);
if (breaches.length) {
  console.log('BREACHES:');
  for (const b of breaches) console.log(`  [${b.persona}] ${b.target} :: ${b.actual}`);
}
await browser.close();
