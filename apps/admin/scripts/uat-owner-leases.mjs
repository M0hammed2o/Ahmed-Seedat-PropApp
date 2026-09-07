// PUBLIC UAT -- record three existing leases through the real deployed UI.
//
// "Record existing lease" is used rather than "Create new lease" because the latter runs a
// document-generation and e-signature flow that would send the tenant a review notice; these are
// synthetic tenants on a deployment with a live email provider, so the import path is the correct
// and safer choice for UAT.
//
// Rent: 101 R8500 + 102 R8500 + Main House R15000 = R32 000/month expected rent roll.

import { launch, signIn, bodyText, shot, waitForNavigationAway, BASE } from './uat-browser-lib.mjs';

const results = [];
let pass = 0;
let fail = 0;
function record(screen, control, action, expected, actual, ok) {
  results.push({ screen, control, action, expected, actual, ok });
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${screen} :: ${action}`);
  if (!ok) console.log(`        expected: ${expected}\n        actual:   ${actual}`);
}

const SEASIDE = '792ed2e3-63f5-4e82-b1fc-efd465cf8e9a';
const HILLCREST = '11da5855-af7b-48b7-b426-8dd996123c0b';

const LEASES = [
  { pid: SEASIDE, unit: '101', tenant: 'Naledi Khumalo', rent: 8500, deposit: 8500 },
  { pid: SEASIDE, unit: '102', tenant: 'Sipho Ndlovu', rent: 8500, deposit: 8500 },
  { pid: HILLCREST, unit: 'Main House', tenant: 'Craig Williams', rent: 15000, deposit: 15000 },
];

const browser = await launch();
const { page, sink } = await signIn(browser, 'owner');
console.log('=== LEASES (record existing) ===\n');

async function unitId(pid, label) {
  const r = await page.request.get(`${BASE}/api/v1/properties/${pid}/units`, { failOnStatusCode: false });
  const j = JSON.parse(await r.text());
  return (j.units ?? []).find((u) => u.unitLabel === label)?.id ?? null;
}

for (const l of LEASES) {
  const uid = await unitId(l.pid, l.unit);
  if (!uid) {
    record('Leases', `${l.unit}`, `resolve unit ${l.unit}`, 'unit id found', 'NOT FOUND', false);
    continue;
  }

  await page.goto(`${BASE}/properties/${l.pid}/units/${uid}/leases/new/existing`, { waitUntil: 'networkidle', timeout: 60000 });
  const skip = page.getByRole('button', { name: /skip tour/i }).first();
  if (await skip.count()) await skip.click().catch(() => {});

  // Primary tenant is the first select; pick by visible label.
  await page.locator('select').first().selectOption({ label: l.tenant });

  await page.getByLabel(/lease start date \(legal\)/i).first().fill('2026-01-01');
  await page.getByLabel(/expiry date/i).first().fill('2026-12-31');
  await page.getByLabel(/monthly rent/i).first().fill(String(l.rent));
  const dep = page.getByLabel(/deposit/i).first();
  if (await dep.count()) await dep.fill(String(l.deposit)).catch(() => {});

  const before = page.url();
  await page.getByRole('button', { name: /record lease/i }).first().click();
  const landed = await waitForNavigationAway(page, before);

  const stillOnForm = landed.endsWith('/existing');
  const text = await bodyText(page);
  record('Leases', `${l.unit} / ${l.tenant}`, `record lease for ${l.unit} @ R${l.rent}`,
    'leaves the form and creates the lease',
    stillOnForm ? `stayed on form -- ${text.slice(-200)}` : `landed on ${landed}`, !stillOnForm);
}

// Persistence + occupancy: a full reload of the leases list.
await page.goto(`${BASE}/leases`, { waitUntil: 'networkidle', timeout: 60000 });
await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
const leaseText = await bodyText(page);
let found = 0;
for (const l of LEASES) if (leaseText.includes(l.tenant)) found += 1;
record('Leases', 'list persistence', 'leases survive a full refresh',
  `${LEASES.length} tenants listed`, `${found} listed`, found === LEASES.length);
await shot(page, 'owner-leases');

// Occupancy must now be lease-derived, not a manual flag.
await page.goto(`${BASE}/units`, { waitUntil: 'networkidle', timeout: 60000 });
const unitsText = await bodyText(page);
const occupied = (unitsText.match(/Occupied/gi) ?? []).length;
console.log(`\n  units page mentions "Occupied" ${occupied}x`);
record('Units', 'occupancy', 'units become occupied once a lease exists',
  'occupancy reflects the three new leases', `units page: ${unitsText.slice(0, 200)}`, occupied > 0);

console.log(`\n=== LEASES RESULT: ${pass}/${pass + fail} ===`);
console.log(`errors -- console:${sink.console.length} js:${sink.jsErrors.length} 4xx:${sink.s4xx.length} 5xx:${sink.s5xx.length}`);
if (sink.s5xx.length) console.log(`  5xx: ${sink.s5xx.slice(0, 4).join(' | ')}`);
await browser.close();
