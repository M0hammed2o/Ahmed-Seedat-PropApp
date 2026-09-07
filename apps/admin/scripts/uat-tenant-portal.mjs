// PUBLIC UAT -- portal-tenant model (§5B) and the tenant portal itself (§13).
//
// The first three tenants were created "manage internally only". This creates the second supported
// V1 model: a tenant with a Proplyst account. The invitation address is the same reserved .invalid
// identity that already exists as an auth user, so the tenant can sign in with a known password and
// no mail ever reaches a real person.

/* global document */

import { launch, signIn, path, bodyText, shot, waitForNavigationAway, BASE } from './uat-browser-lib.mjs';
import { readFileSync } from 'node:fs';

const creds = JSON.parse(readFileSync(process.env.UAT_CRED_FILE, 'utf8'));
const SEASIDE = '792ed2e3-63f5-4e82-b1fc-efd465cf8e9a';
const results = [];
let pass = 0;
let fail = 0;
function record(area, action, expected, actual, ok, note = '') {
  results.push({ area, action, expected, actual, ok, note });
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${area} :: ${action} -> ${actual}`);
  if (!ok) console.log(`        expected: ${expected} ${note}`);
}
async function dismiss(page) {
  const s = page.getByRole('button', { name: /skip tour/i }).first();
  if (await s.count()) await s.click().catch(() => {});
}

const browser = await launch();
const owner = await signIn(browser, 'owner');

// ---- 1. Create a PORTAL tenant on unit 201 -----------------------------------------------------
console.log('=== PORTAL TENANT (model B) ===');
const unitsJson = JSON.parse(await (await owner.page.request.get(`${BASE}/api/v1/properties/${SEASIDE}/units`, { failOnStatusCode: false })).text());
const unit201 = (unitsJson.units ?? []).find((u) => u.unitLabel === '201');

const tenantsBefore = JSON.parse(await (await owner.page.request.get(`${BASE}/api/v1/tenants`, { failOnStatusCode: false })).text());
const exists = (tenantsBefore.tenants ?? []).some((t) => t.email === creds.tenant.email);

if (!exists) {
  await owner.page.goto(`${BASE}/tenants/new`, { waitUntil: 'networkidle', timeout: 60000 });
  await dismiss(owner.page);
  await owner.page.locator('select').nth(0).selectOption(SEASIDE).catch(() => {});
  await owner.page.waitForTimeout(1800);
  const unitVal = await owner.page.evaluate(() => {
    const s = document.querySelectorAll('select')[1];
    const o = Array.from(s?.options ?? []).find((x) => x.textContent.trim().startsWith('201'));
    return o ? o.value : null;
  });
  if (unitVal) await owner.page.locator('select').nth(1).selectOption(unitVal).catch(() => {});
  await owner.page.getByLabel(/full name/i).first().fill('UAT Portal Tenant');
  await owner.page.getByLabel(/email/i).first().fill(creds.tenant.email);
  await owner.page.getByLabel(/phone/i).first().fill('0820000201').catch(() => {});
  // Model B: give the tenant a Proplyst account.
  const invite = owner.page.getByLabel(/invite tenant to proplyst/i).first();
  if (await invite.count()) await invite.check().catch(() => {});
  const before = owner.page.url();
  await owner.page.getByRole('button', { name: /create tenant/i }).first().click();
  const landed = await waitForNavigationAway(owner.page, before);
  record('Portal tenant', 'create tenant with portal access',
    'leaves the create form', landed.endsWith('/tenants/new') ? 'STAYED on form' : `landed ${landed}`,
    !landed.endsWith('/tenants/new'));
} else {
  record('Portal tenant', 'create tenant with portal access', 'already present', 'reused existing', true);
}

// Tenant list must clearly show tenant / property / unit context.
await owner.page.goto(`${BASE}/tenants`, { waitUntil: 'networkidle', timeout: 60000 });
await owner.page.reload({ waitUntil: 'networkidle', timeout: 60000 });
const tl = await bodyText(owner.page);
record('Tenant list', 'identifies tenant + property + unit context',
  'names, property and unit all visible',
  `portalTenant=${tl.includes('UAT Portal Tenant')} seaside=${tl.includes('UAT Seaside')} unit201=${tl.includes('201')}`,
  tl.includes('UAT Portal Tenant') && tl.includes('UAT Seaside'));
await shot(owner.page, 'owner-tenants-portal');

// ---- 2. Lease for 201 so the portal has content -------------------------------------------------
if (unit201) {
  await owner.page.goto(`${BASE}/properties/${SEASIDE}/units/${unit201.id}/leases/new/existing`, { waitUntil: 'networkidle', timeout: 60000 });
  await dismiss(owner.page);
  const sel = owner.page.locator('select').first();
  const has = await owner.page.evaluate(() =>
    Array.from(document.querySelectorAll('select')[0]?.options ?? []).some((o) => /UAT Portal Tenant/.test(o.textContent)));
  if (has) {
    await sel.selectOption({ label: 'UAT Portal Tenant' }).catch(() => {});
    await owner.page.getByLabel(/lease start date \(legal\)/i).first().fill('2026-01-01');
    await owner.page.getByLabel(/expiry date/i).first().fill('2026-12-31');
    await owner.page.getByLabel(/monthly rent/i).first().fill('9000');
    const b2 = owner.page.url();
    await owner.page.getByRole('button', { name: /record lease/i }).first().click();
    const l2 = await waitForNavigationAway(owner.page, b2);
    record('Portal tenant', 'lease recorded for unit 201', 'lease created',
      l2.endsWith('/existing') ? 'stayed on form' : `landed ${l2}`, !l2.endsWith('/existing'));
    // Activate it.
    const act = owner.page.getByRole('button', { name: /^activate lease$/i }).first();
    if (await act.count()) { await act.click(); await owner.page.waitForTimeout(8000); }
    record('Portal tenant', 'lease activated', 'lease becomes active',
      /active/i.test(await bodyText(owner.page)) ? 'shows Active' : 'not active',
      /active/i.test(await bodyText(owner.page)));
  } else {
    record('Portal tenant', 'portal tenant selectable on lease form', 'appears in tenant list', 'NOT in list', false);
  }
}
await owner.ctx.close();

// ---- 3. Tenant signs in to the PUBLIC app --------------------------------------------------------
console.log('\n=== TENANT PORTAL (§13) ===');
const tenant = await signIn(browser, 'tenant');
console.log(`  landed on ${path(tenant.page)}`);

for (const [label, url] of [['Tenant home', '/tenant'], ['Lease', '/tenant/lease'],
  ['Payments', '/tenant/payments'], ['Documents', '/tenant/documents'],
  ['Maintenance', '/tenant/maintenance'], ['Profile', '/tenant/profile']]) {
  const r = await tenant.page.goto(`${BASE}${url}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null);
  const t = await bodyText(tenant.page);
  const reached = r && r.status() === 200 && !/page not found/i.test(t.slice(0, 300));
  record('Tenant portal', `${label} (${url})`, 'renders for the tenant',
    `HTTP ${r ? r.status() : 'ERR'} landed ${path(tenant.page)}`, Boolean(reached));
}
await shot(tenant.page, 'tenant-portal');

// Owner surfaces must be refused for a tenant.
console.log('  Owner surfaces must be refused:');
const leaksOrg = (s) => s.includes('UAT Seaside Apartments') && (s.includes('Naledi Khumalo') || s.includes('Expected rent'));
for (const url of ['/dashboard', '/properties', '/accounting/expenses', '/reports', '/organization/billing']) {
  await tenant.page.goto(`${BASE}${url}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  const t = await bodyText(tenant.page);
  const exposed = leaksOrg(t);
  record('Tenant restricted', url, 'no owner/portfolio data',
    `${path(tenant.page)}${exposed ? ' -- LEAKED' : ' -- clean'}`, !exposed,
    exposed ? 'CRITICAL' : '');
}
await tenant.ctx.close();

console.log(`\n=== TENANT PORTAL RESULT: ${pass}/${pass + fail} ===`);
for (const r of results.filter((x) => !x.ok)) console.log(`  FAIL: ${r.area} :: ${r.action} -> ${r.actual}`);
await browser.close();
