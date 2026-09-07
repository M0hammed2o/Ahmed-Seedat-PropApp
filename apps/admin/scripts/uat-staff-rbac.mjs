// PUBLIC UAT -- provision the synthetic staff persona INTO the UAT organisation through the real
// owner UI, then test what that role may and may not do.
//
// The earlier security pass proved cross-account isolation (staff was a non-member). This pass
// proves the harder property: role restriction INSIDE the organisation. Navigation hiding is not
// security, so every restricted surface is also probed by direct URL and direct API call.
//
// The activation email goes to a reserved .invalid address that cannot reach a real person.

/* global document */

import { launch, signIn, path, bodyText, shot, BASE } from './uat-browser-lib.mjs';
import { readFileSync } from 'node:fs';

const results = [];
let pass = 0;
let fail = 0;
function record(area, action, expected, actual, ok, note = '') {
  results.push({ area, action, expected, actual, ok, note });
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${area} :: ${action} -> ${actual}`);
  if (!ok) console.log(`        expected: ${expected} ${note}`);
}

const creds = JSON.parse(readFileSync(process.env.UAT_CRED_FILE, 'utf8'));
const ORG = creds.orgId;
const SEASIDE = '792ed2e3-63f5-4e82-b1fc-efd465cf8e9a';

const browser = await launch();

// ---- 1. Owner adds the staff member ----------------------------------------------------------
console.log('=== STAFF PROVISIONING (as owner, real UI) ===');
const owner = await signIn(browser, 'owner');
await owner.page.goto(`${BASE}/organization/staff`, { waitUntil: 'networkidle', timeout: 60000 });
const skip = owner.page.getByRole('button', { name: /skip tour/i }).first();
if (await skip.count()) await skip.click().catch(() => {});

const already = (await bodyText(owner.page)).includes(creds.staff.email);
if (already) {
  console.log('  staff already provisioned -- reusing');
} else {
  await owner.page.getByRole('button', { name: /add staff member/i }).first().click();
  await owner.page.waitForTimeout(2500);
  await owner.page.getByLabel(/full name/i).first().fill('UAT Property Manager').catch(() => {});
  await owner.page.getByLabel(/email/i).first().fill(creds.staff.email);
  await owner.page.locator('select').first().selectOption({ label: 'Manager' }).catch(() => {});
  await owner.page.getByRole('button', { name: /^add staff member$/i }).last().click();
  await owner.page.waitForTimeout(8000);
}

await owner.page.goto(`${BASE}/organization/staff`, { waitUntil: 'networkidle', timeout: 60000 });
await owner.page.reload({ waitUntil: 'networkidle', timeout: 60000 });
const staffList = await bodyText(owner.page);
record('Staff provisioning', 'staff member appears in the org staff list after refresh',
  'the UAT staff email is listed', staffList.includes(creds.staff.email) ? 'listed' : 'NOT listed',
  staffList.includes(creds.staff.email));
await shot(owner.page, 'owner-staff-list');
await owner.ctx.close();

// ---- 2. Staff signs in and exercises the role -------------------------------------------------
console.log('\n=== STAFF PERSONA (in-org role restriction) ===');
const staff = await signIn(browser, 'staff');
console.log(`  landed on ${path(staff.page)}`);

const orgs = JSON.parse(await (await staff.page.request.get(`${BASE}/api/v1/organizations`, { failOnStatusCode: false })).text());
const membership = (orgs.organizations ?? []).find((o) => o.orgId === ORG);
record('Staff persona', 'staff is now a member of the UAT organisation',
  'membership present', membership ? `role=${membership.role} status=${membership.status}` : 'NOT a member',
  Boolean(membership));

// Surfaces a manager legitimately needs.
console.log('  ALLOWED surfaces:');
for (const [label, url] of [['Dashboard', '/dashboard'], ['Properties', '/properties'],
  ['Property detail', `/properties/${SEASIDE}`], ['Tenants', '/tenants'], ['Leases', '/leases'],
  ['Maintenance', '/maintenance'], ['Expenses', '/accounting/expenses'], ['Documents', '/documents']]) {
  await staff.page.goto(`${BASE}${url}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  const t = await bodyText(staff.page);
  const landed = path(staff.page);
  const reached = landed === url && !/page not found|something went wrong/i.test(t.slice(0, 300));
  record('Staff allowed', `${label} (${url})`, 'manager can open this surface',
    reached ? 'opened' : `landed ${landed}`, reached);
}

// Principal-only surfaces. Migration 20260101000125 made staff administration principal-only.
console.log('  RESTRICTED surfaces (must be refused server-side):');
for (const [label, url] of [['Org staff admin', '/organization/staff'], ['Org billing', '/organization/billing']]) {
  await staff.page.goto(`${BASE}${url}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  const t = await bodyText(staff.page);
  const landed = path(staff.page);
  // The product refuses these with a proper in-page denial panel ("Access restricted -- Only the
  // organization principal can manage ...") rather than a redirect. An earlier matcher missed that
  // wording and produced a false privilege-escalation finding, so match it explicitly, and also
  // require that no action controls or roster data leaked onto the page.
  const refused =
    landed !== url ||
    /access restricted|not authorised|not authorized|no access|forbidden|only the organization principal|page not found/i.test(t);
  const actionControls = await staff.page.evaluate(() =>
    Array.from(document.querySelectorAll('button,a'))
      .filter((b) => b.offsetParent !== null)
      .map((b) => (b.textContent || '').trim())
      .filter((x) => /add staff|remove|revoke|invite|change role|subscribe|cancel plan/i.test(x)).length);
  record('Staff restricted', `${label} (${url})`, 'refused, and no action controls exposed',
    refused && actionControls === 0
      ? `refused (${actionControls} action controls)`
      : `RENDERED with ${actionControls} action controls`,
    refused && actionControls === 0,
    refused ? '' : 'possible privilege escalation');
}

// Direct API mutations a manager must not be able to perform.
console.log('  RESTRICTED API (direct calls, nav bypassed):');
const apiProbes = [
  ['add staff member', 'POST', `/api/v1/organizations/${ORG}/staff-provisions`, { email: 'uat-escalation@uat-proplyst.invalid', role: 'manager' }],
  ['change a member role', 'POST', `/api/v1/organizations/${ORG}/members`, { role: 'principal' }],
  ['start a billing quote', 'POST', `/api/v1/organizations/${ORG}/billing/quote`, { planId: 'x', interval: 'monthly' }],
];
for (const [label, method, url, body] of apiProbes) {
  const r = await staff.page.request.fetch(`${BASE}${url}`, { method, data: body, failOnStatusCode: false });
  const s = r.status();
  const refused = s === 401 || s === 403 || s === 404 || s === 400 || s === 405 || s === 422;
  record('Staff restricted API', `${method} ${label}`, '401/403/404 -- never 200 success',
    `HTTP ${s}`, refused, refused ? '' : 'PRIVILEGE ESCALATION');
}

await staff.ctx.close();
console.log(`\n=== STAFF RBAC RESULT: ${pass}/${pass + fail} ===`);
for (const r of results.filter((x) => !x.ok)) console.log(`  FAIL: ${r.area} :: ${r.action} -> ${r.actual}`);
await browser.close();
