// PUBLIC UAT -- owner operational + financial workflows through the real deployed UI.
//
// Controlled values chosen so the arithmetic can be verified independently:
//   Seaside   Rates & taxes 3500 + Levies 1800 + Water 950 = 6250
//   Hillcrest Maintenance 1200
//   => total expenses 7450.  Rent roll is 32000/month (3 active leases).
//
// NOTE ON SCOPE: the effective-dated recurring-cost schedule and utility settings are BLOCKED by
// the known production defect (migrations 163-168 unapplied). Recording rates/levies/water as
// *expenses* is a different, working feature and is what is exercised here. Nothing is written to
// the database directly to make a blocked workflow look like it passed.

/* global document */

import { launch, signIn, path, bodyText, shot, waitForNavigationAway, BASE } from './uat-browser-lib.mjs';
import { writeFileSync } from 'node:fs';

const results = [];
let pass = 0;
let fail = 0;
let blocked = 0;
function record(area, action, expected, actual, status, note = '') {
  results.push({ area, action, expected, actual, status, note });
  if (status === 'PASS') pass += 1;
  else if (status === 'BLOCKED') blocked += 1;
  else fail += 1;
  console.log(`  ${status.padEnd(7)} ${area} :: ${action} -> ${actual}`);
  if (status === 'FAIL') console.log(`          expected: ${expected} ${note}`);
}

async function dismissTour(page) {
  const skip = page.getByRole('button', { name: /skip tour/i }).first();
  if (await skip.count()) await skip.click().catch(() => {});
  await page.waitForTimeout(300);
}

const SEASIDE = 'UAT Seaside Apartments';
const HILLCREST = 'UAT Hillcrest House';

const EXPENSES = [
  { prop: SEASIDE, category: 'Rates & taxes', amount: 3500, ref: 'UAT-RATES-01' },
  { prop: SEASIDE, category: 'Levies', amount: 1800, ref: 'UAT-LEVY-01' },
  { prop: SEASIDE, category: 'Water', amount: 950, ref: 'UAT-WATER-01' },
  { prop: HILLCREST, category: 'Maintenance', amount: 1200, ref: 'UAT-MAINT-01' },
];
const EXPECTED_TOTAL = EXPENSES.reduce((s, e) => s + e.amount, 0); // 7450

const browser = await launch();
const { page, sink } = await signIn(browser, 'owner');
console.log('=== OWNER OPERATIONS ===\n');

// ---- Expenses ---------------------------------------------------------------------------------
console.log('--- EXPENSES (create -> refresh -> verify) ---');
for (const e of EXPENSES) {
  await page.goto(`${BASE}/accounting/expenses/new`, { waitUntil: 'networkidle', timeout: 60000 });
  await dismissTour(page);

  await page.locator('select').nth(0).selectOption({ label: e.prop }).catch(() => {});
  await page.waitForTimeout(1200);
  // select index 2 is Category (0 property, 1 unit)
  await page.locator('select').nth(2).selectOption({ label: e.category }).catch(() => {});
  await page.getByLabel(/amount/i).first().fill(String(e.amount));
  const ref = page.getByLabel(/reference/i).first();
  if (await ref.count()) await ref.fill(e.ref).catch(() => {});
  const inv = page.getByLabel(/invoice date/i).first();
  if (await inv.count()) await inv.fill('2026-09-01').catch(() => {});

  const before = page.url();
  await page.getByRole('button', { name: /^add expense$/i }).first().click();
  const landed = await waitForNavigationAway(page, before);
  record('Expenses', `${e.category} R${e.amount} on ${e.prop}`, 'leaves the create form',
    landed.endsWith('/new') ? 'STAYED on form' : `landed ${landed}`,
    landed.endsWith('/new') ? 'FAIL' : 'PASS');
}

await page.goto(`${BASE}/accounting/expenses`, { waitUntil: 'networkidle', timeout: 60000 });
await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
const expText = await bodyText(page);
let refsFound = 0;
for (const e of EXPENSES) if (expText.includes(e.ref)) refsFound += 1;
record('Expenses', 'all expenses survive a full refresh', `${EXPENSES.length} references present`,
  `${refsFound} of ${EXPENSES.length} present`, refsFound === EXPENSES.length ? 'PASS' : 'FAIL');
await shot(page, 'owner-expenses');

// Reconciliation: does the listed total equal the controlled sum?
const totalMatch = expText.replace(/ /g, ' ').match(/R\s?7\s?450/);
record('Expenses', `total reconciles to R${EXPECTED_TOTAL}`, `R${EXPECTED_TOTAL} appears`,
  totalMatch ? `found "${totalMatch[0]}"` : 'total not found in page text',
  totalMatch ? 'PASS' : 'FAIL', 'check the expense list total');

// ---- Recurring costs / utilities: record the known production failure, do not bypass ----------
console.log('\n--- RECURRING COSTS + UTILITY SETTINGS (known production defect) ---');
const propsResp = await page.request.get(`${BASE}/api/v1/properties`, { failOnStatusCode: false });
const propsJson = JSON.parse(await propsResp.text());
const seasideId = (propsJson.properties ?? []).find((p) => p.nickname === SEASIDE)?.id;
for (const [label, url] of [
  ['rates & levies schedule', `/api/v1/properties/${seasideId}/recurring-costs`],
  ['utility responsibility', `/api/v1/properties/${seasideId}/utility-settings`],
]) {
  const r = await page.request.get(`${BASE}${url}`, { failOnStatusCode: false });
  const body = (await r.text()).slice(0, 160);
  record('Recurring costs', label, 'HTTP 200 with the schedule',
    `HTTP ${r.status()} ${body}`, r.status() === 500 ? 'BLOCKED' : (r.status() === 200 ? 'PASS' : 'FAIL'),
    'blocked by unapplied migrations 163-168');
}

// ---- Maintenance -------------------------------------------------------------------------------
console.log('\n--- MAINTENANCE ---');
await page.goto(`${BASE}/maintenance`, { waitUntil: 'networkidle', timeout: 60000 });
await dismissTour(page);
const maintCtrls = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button,a'))
    .map((b) => ({ t: (b.textContent || '').trim(), h: b.getAttribute && b.getAttribute('href') }))
    .filter((x) => x.t && /new ticket|add|log|create|report/i.test(x.t)).slice(0, 6));
console.log(`  controls: ${JSON.stringify(maintCtrls)}`);
if (maintCtrls.length) {
  const target = maintCtrls.find((c) => c.h) ?? maintCtrls[0];
  if (target.h) await page.goto(`${BASE}${target.h}`, { waitUntil: 'networkidle', timeout: 60000 });
  else await page.getByRole('button', { name: new RegExp(target.t.slice(0, 12), 'i') }).first().click().catch(() => {});
  await page.waitForTimeout(2500);
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('label')).map((l) => (l.textContent || '').trim().slice(0, 40)));
  console.log(`  form labels: ${JSON.stringify(labels)}`);
  record('Maintenance', 'ticket form reachable', 'a create form opens',
    labels.length ? `form with ${labels.length} fields at ${path(page)}` : `no form at ${path(page)}`,
    labels.length ? 'PASS' : 'FAIL');
} else {
  record('Maintenance', 'create control present', 'a create control exists', 'none found', 'FAIL');
}

// ---- Remaining owner surfaces -------------------------------------------------------------------
console.log('\n--- NOTIFICATIONS / ACTIVITY / REPORTS / SETTINGS ---');
for (const [label, url] of [['Notifications', '/notifications'], ['Activity', '/organization/activity'],
  ['Reports', '/reports'], ['Settings', '/settings'], ['Announcements', '/announcements']]) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  const t = await bodyText(page);
  const ok = path(page) === url && !/page not found|something went wrong/i.test(t.slice(0, 300));
  record('Owner surfaces', `${label} (${url})`, 'renders without error',
    ok ? 'rendered' : `landed ${path(page)}`, ok ? 'PASS' : 'FAIL');
}

// Activity should record the writes this pass performed.
await page.goto(`${BASE}/organization/activity`, { waitUntil: 'networkidle', timeout: 60000 });
const actText = await bodyText(page);
record('Activity', 'audit trail shows this session\'s writes',
  'property/unit/lease/expense activity listed',
  /propert|unit|lease|expense/i.test(actText) ? 'activity entries present' : 'no recognisable entries',
  /propert|unit|lease|expense/i.test(actText) ? 'PASS' : 'FAIL');

console.log(`\n=== OPS RESULT: ${pass} pass / ${fail} fail / ${blocked} blocked ===`);
console.log(`errors -- js:${sink.jsErrors.length} 4xx:${sink.s4xx.length} 5xx:${sink.s5xx.length}`);
if (sink.s5xx.length) console.log(`  5xx: ${[...new Set(sink.s5xx)].slice(0, 4).join(' | ')}`);
writeFileSync(process.env.UAT_OPS_OUT ?? 'uat-ops.json', JSON.stringify({ pass, fail, blocked, results }, null, 2));
await browser.close();
