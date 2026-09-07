// PUBLIC UAT -- owner data build (units, tenants) through the real deployed UI.
//
// Controlled synthetic values are chosen so the arithmetic can be checked independently later:
//   Seaside  101 R8500 + 102 R8500 + 201 R9000 = R26 000 let, 202 R9000 vacant
//   Hillcrest Main House R15 000 let
//   Offices  Suite A R12 000 let, Suite B R12 000 vacant
//   => 7 units, 5 let, 2 vacant. Expected monthly rent roll from let units = R53 000.

/* global document */

import { launch, signIn, path, bodyText, shot, waitForNavigationAway, BASE } from './uat-browser-lib.mjs';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const STATE = process.env.UAT_STATE_OUT ?? 'uat-state.json';
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const results = [];
let pass = 0;
let fail = 0;

function record(screen, control, action, expected, actual, ok, notes = '') {
  results.push({ screen, control, action, expected, actual, ok, notes });
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${screen} :: ${action}`);
  if (!ok) console.log(`        expected: ${expected}\n        actual:   ${actual}`);
}

async function dismissTour(page) {
  const skip = page.getByRole('button', { name: /skip tour/i }).first();
  if (await skip.count()) await skip.click().catch(() => {});
  await page.waitForTimeout(300);
}

const PROPS = {
  'UAT Seaside Apartments': '792ed2e3-63f5-4e82-b1fc-efd465cf8e9a',
  'UAT Hillcrest House': '11da5855-af7b-48b7-b426-8dd996123c0b',
  'UAT Central Offices': 'a1668e3a-85d1-4c5c-90f3-294fe845f0ea',
};

const UNITS = [
  { prop: 'UAT Seaside Apartments', label: '101', beds: 2, baths: 1, size: 68, rent: 8500 },
  { prop: 'UAT Seaside Apartments', label: '102', beds: 2, baths: 1, size: 68, rent: 8500 },
  { prop: 'UAT Seaside Apartments', label: '201', beds: 3, baths: 2, size: 92, rent: 9000 },
  { prop: 'UAT Seaside Apartments', label: '202', beds: 3, baths: 2, size: 92, rent: 9000 },
  { prop: 'UAT Hillcrest House', label: 'Main House', beds: 4, baths: 3, size: 240, rent: 15000 },
  { prop: 'UAT Central Offices', label: 'Suite A', beds: 0, baths: 1, size: 120, rent: 12000 },
  { prop: 'UAT Central Offices', label: 'Suite B', beds: 0, baths: 1, size: 120, rent: 12000 },
];

// Tenants are created "manage internally only" -- no invitation email is sent to anyone.
const TENANTS = [
  { name: 'Naledi Khumalo', email: 'uat-tenant-naledi@uat-proplyst.invalid', phone: '0820000101', prop: 'UAT Seaside Apartments', unit: '101' },
  { name: 'Sipho Ndlovu', email: 'uat-tenant-sipho@uat-proplyst.invalid', phone: '0820000102', prop: 'UAT Seaside Apartments', unit: '102' },
  { name: 'Craig Williams', email: 'uat-tenant-craig@uat-proplyst.invalid', phone: '0820000103', prop: 'UAT Hillcrest House', unit: 'Main House' },
];

const browser = await launch();
const { page, sink } = await signIn(browser, 'owner');
console.log('=== OWNER DATA BUILD (public deployment) ===\n');

// ---- Units ------------------------------------------------------------------------------------
console.log('--- UNITS ---');
for (const u of UNITS) {
  const pid = PROPS[u.prop];
  await page.goto(`${BASE}/properties/${pid}/units/new`, { waitUntil: 'networkidle', timeout: 60000 });
  await dismissTour(page);

  await page.getByLabel(/unit label/i).first().fill(u.label);
  for (const [re, val] of [[/bedrooms/i, u.beds], [/bathrooms/i, u.baths], [/size/i, u.size], [/market rent/i, u.rent]]) {
    const f = page.getByLabel(re).first();
    if (await f.count()) await f.fill(String(val)).catch(() => {});
  }

  const before = page.url();
  await page.getByRole('button', { name: /create unit/i }).first().click();
  const landed = await waitForNavigationAway(page, before);
  record('Units', `${u.prop} / ${u.label}`, `create unit ${u.label} @ R${u.rent}`,
    'leaves the create form', `landed on ${landed}`, landed !== path({ url: () => before }) && !landed.endsWith('/units/new'));
}

// Persistence check via a full reload of the units list.
await page.goto(`${BASE}/units`, { waitUntil: 'networkidle', timeout: 60000 });
await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
const unitsText = await bodyText(page);
let unitsFound = 0;
for (const u of UNITS) if (unitsText.includes(u.label)) unitsFound += 1;
record('Units', 'list persistence', 'all 7 units survive a full refresh',
  '7 of 7 present after reload', `${unitsFound} of ${UNITS.length} present`, unitsFound === UNITS.length);
await shot(page, 'owner-units');

// ---- Tenants ----------------------------------------------------------------------------------
console.log('\n--- TENANTS ---');
for (const t of TENANTS) {
  await page.goto(`${BASE}/tenants/new`, { waitUntil: 'networkidle', timeout: 60000 });
  await dismissTour(page);

  const selects = page.locator('select');
  await selects.nth(0).selectOption(PROPS[t.prop]).catch(() => {});
  await page.waitForTimeout(1800); // unit list is populated from the property choice

  // Pick the unit option whose visible label matches.
  const unitVal = await page.evaluate((label) => {
    const s = document.querySelectorAll('select')[1];
    if (!s) return null;
    const o = Array.from(s.options).find((x) => x.textContent.trim() === label || x.textContent.trim().startsWith(label));
    return o ? o.value : null;
  }, t.unit);
  if (unitVal) await selects.nth(1).selectOption(unitVal).catch(() => {});

  await page.getByLabel(/full name/i).first().fill(t.name);
  const em = page.getByLabel(/email/i).first();
  if (await em.count()) await em.fill(t.email).catch(() => {});
  const ph = page.getByLabel(/phone/i).first();
  if (await ph.count()) await ph.fill(t.phone).catch(() => {});

  // Keep the tenant internal -- this deployment has a live email provider, so no invitation is sent.
  const internal = page.getByLabel(/manage internally only/i).first();
  if (await internal.count()) await internal.check().catch(() => {});

  const before = page.url();
  await page.getByRole('button', { name: /create tenant/i }).first().click();
  const landed = await waitForNavigationAway(page, before);
  record('Tenants', t.name, `create tenant ${t.name} (internal only, unit ${t.unit})`,
    'leaves the create form', `landed on ${landed}`, !landed.endsWith('/tenants/new'));
}

await page.goto(`${BASE}/tenants`, { waitUntil: 'networkidle', timeout: 60000 });
await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
const tenantsText = await bodyText(page);
let tFound = 0;
for (const t of TENANTS) if (tenantsText.includes(t.name)) tFound += 1;
record('Tenants', 'list persistence', 'all tenants survive a full refresh',
  `${TENANTS.length} of ${TENANTS.length} present`, `${tFound} of ${TENANTS.length} present`, tFound === TENANTS.length);
await shot(page, 'owner-tenants');

console.log(`\n=== PHASE RESULT: ${pass}/${pass + fail} ===`);
console.log(`errors -- console:${sink.console.length} js:${sink.jsErrors.length} 4xx:${sink.s4xx.length} 5xx:${sink.s5xx.length}`);
if (sink.s5xx.length) console.log(`  5xx: ${sink.s5xx.slice(0, 5).join(' | ')}`);
if (sink.s4xx.length) console.log(`  4xx: ${sink.s4xx.slice(0, 6).join(' | ')}`);

state.propIds = PROPS;
state.dataResults = results;
writeFileSync(STATE, JSON.stringify(state, null, 2));
await browser.close();
