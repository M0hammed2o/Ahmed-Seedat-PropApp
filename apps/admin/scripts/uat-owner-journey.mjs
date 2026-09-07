// PUBLIC UAT -- owner journey against https://proplyst.co.za.
//
// Everything here happens through the real deployed UI as a signed-in customer would do it: no
// database writes, no API shortcuts. Each important save is followed by a full page refresh and a
// re-read, so "it persisted" means the server really stored it, not that React kept it in state.
//
// Scope: the synthetic "Proplyst UAT Portfolio" organisation only.

/* global document */

import { launch, signIn, path, bodyText, shot, BASE } from './uat-browser-lib.mjs';
import { writeFileSync } from 'node:fs';

const results = [];
let pass = 0;
let fail = 0;

function record(screen, control, action, expected, actual, ok, notes = '') {
  results.push({ screen, control, action, expected, actual, ok, notes });
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${screen} :: ${action}`);
  if (!ok) console.log(`        expected: ${expected}\n        actual:   ${actual}`);
}

// The first-run walkthrough is a fixed overlay that has previously swallowed clicks on real
// controls in this codebase -- dismiss it before driving any form.
async function dismissTour(page) {
  const skip = page.getByRole('button', { name: /skip tour/i }).first();
  if (await skip.count()) await skip.click().catch(() => {});
  await page.waitForTimeout(400);
}

async function fillByLabel(page, label, value) {
  const f = page.getByLabel(label).first();
  if (!(await f.count())) return false;
  await f.fill(String(value));
  return true;
}

const PROPERTIES = [
  {
    name: 'UAT Seaside Apartments',
    type: 'apartment_building',
    line1: '14 Marine Parade',
    suburb: 'North Beach',
    city: 'Durban',
    province: 'KwaZulu-Natal',
    postal: '4001',
  },
  {
    name: 'UAT Hillcrest House',
    type: 'house',
    line1: '7 Old Main Road',
    suburb: 'Hillcrest',
    city: 'Durban',
    province: 'KwaZulu-Natal',
    postal: '3610',
  },
  {
    name: 'UAT Central Offices',
    type: 'commercial',
    line1: '220 Anton Lembede Street',
    suburb: 'Durban Central',
    city: 'Durban',
    province: 'KwaZulu-Natal',
    postal: '4001',
  },
];

const browser = await launch();
const { page, sink } = await signIn(browser, 'owner');

console.log('=== OWNER JOURNEY (public deployment) ===');
console.log(`TARGET: ${BASE}`);
console.log(`START:  ${path(page)}\n`);

record('Login', 'owner sign-in', 'sign in as UAT owner on the public app',
  'reaches the authenticated dashboard', `landed on ${path(page)}`, path(page) === '/dashboard');

// ---- Properties -------------------------------------------------------------------------------
console.log('\n--- PROPERTIES (create -> refresh -> verify) ---');
for (const p of PROPERTIES) {
  await page.goto(`${BASE}/properties/new`, { waitUntil: 'networkidle', timeout: 60000 });
  await dismissTour(page);

  await fillByLabel(page, /property name/i, p.name);
  const typeSel = page.locator('select').first();
  if (await typeSel.count()) await typeSel.selectOption(p.type).catch(() => {});
  await fillByLabel(page, /address line 1/i, p.line1);
  await fillByLabel(page, /suburb/i, p.suburb);
  await fillByLabel(page, /^city/i, p.city);
  await fillByLabel(page, /province/i, p.province);
  await fillByLabel(page, /postal code/i, p.postal);

  const before = page.url();
  await page.getByRole('button', { name: /create property/i }).first().click();
  await page.waitForURL((u) => u !== before, { timeout: 60000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  const created = path(page);
  record('Properties', p.name, `create "${p.name}" (${p.type})`,
    'navigates away from the create form',
    `landed on ${created}`, created !== '/properties/new');
}

// Persistence: full reload of the list, not client state.
await page.goto(`${BASE}/properties`, { waitUntil: 'networkidle', timeout: 60000 });
await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
const listText = await bodyText(page);
for (const p of PROPERTIES) {
  record('Properties', 'list persistence', `"${p.name}" survives a full refresh`,
    'appears in the reloaded property list',
    listText.includes(p.name) ? 'present after reload' : 'MISSING after reload',
    listText.includes(p.name));
}
await shot(page, 'owner-properties');

// Capture the real property ids for the unit/lease phases.
const propertyLinks = await page.evaluate(() =>
  Array.from(document.querySelectorAll('a[href^="/properties/"]'))
    .map((a) => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim() }))
    .filter((x) => /^\/properties\/[0-9a-f-]{36}$/.test(x.href)));

const propIds = {};
for (const p of PROPERTIES) {
  const hit = propertyLinks.find((l) => l.text.includes(p.name));
  if (hit) propIds[p.name] = hit.href.split('/').pop();
}
console.log(`\n  resolved property ids: ${Object.keys(propIds).length}/${PROPERTIES.length}`);

console.log(`\n=== PHASE RESULT: ${pass}/${pass + fail} ===`);
console.log(`errors so far -- console:${sink.console.length} js:${sink.jsErrors.length} 4xx:${sink.s4xx.length} 5xx:${sink.s5xx.length}`);
if (sink.s5xx.length) console.log(`  5xx: ${sink.s5xx.slice(0, 5).join(' | ')}`);
if (sink.s4xx.length) console.log(`  4xx: ${sink.s4xx.slice(0, 5).join(' | ')}`);

writeFileSync(process.env.UAT_STATE_OUT ?? 'uat-state.json', JSON.stringify({ propIds, results, pass, fail, sink }, null, 2));
await browser.close();
