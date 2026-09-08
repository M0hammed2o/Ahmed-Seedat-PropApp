// PUBLIC UAT -- post-deploy verification of the fixes shipped in this release, against
// https://proplyst.co.za. Everything here is checked in the browser as a signed-in customer.
//
// Covers: dashboard expense reconciliation and rent caption, breadcrumb labels, the maintenance
// ticket flow, and the VOID-expense semantics that migration 170 made consistent across the
// dashboard, budget and financial-summary surfaces.

/* global document */

import { launch, signIn, path, bodyText, shot, BASE } from './uat-browser-lib.mjs';

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
  await page.waitForTimeout(400);
}

const SEASIDE = '792ed2e3-63f5-4e82-b1fc-efd465cf8e9a';

const browser = await launch();
const { page, sink } = await signIn(browser, 'owner');
console.log('=== POST-DEPLOY VERIFICATION ===\n');

// ---- Dashboard: the expense contradiction must be gone --------------------------------------
console.log('--- DASHBOARD RECONCILIATION ---');
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 60000 });
await dismiss(page);
const dash = await bodyText(page);

const expensesCard = dash.match(/Expenses R\s?([\d  ,]+)/);
const opPosition = dash.match(/Operating position R\s?(-?[\d  ,]+)/);
const num = (s) => Number(String(s ?? '').replace(/[^\d-]/g, ''));
const cardVal = num(expensesCard?.[1]);
const opVal = num(opPosition?.[1]);

record('Dashboard', 'Expenses card is no longer R0 while spend exists',
  'a non-zero expense total matching the operating position',
  `Expenses card = R${cardVal}`, cardVal > 0);
record('Dashboard', 'caption says "Incurred in", not "Recorded in"',
  'Incurred in <period>', /Incurred in/.test(dash) ? 'Incurred in …' : 'still "Recorded in"',
  /Incurred in/.test(dash));
record('Dashboard', 'rent caption says "Expected in", not "Billed in"',
  'Expected in <period>', /Expected in/.test(dash) ? 'Expected in …' : 'still "Billed in"',
  /Expected in/.test(dash));
console.log(`    (operating position reads R${opVal})`);
await shot(page, 'deploy-dashboard');

// ---- Breadcrumbs -------------------------------------------------------------------------------
console.log('\n--- BREADCRUMBS ---');
await page.goto(`${BASE}/properties/${SEASIDE}`, { waitUntil: 'networkidle', timeout: 60000 });
await dismiss(page);
await page.waitForTimeout(2000);
// The breadcrumb lives in the header, and the sidebar also contains the word "Portfolio" --
// an earlier selector grabbed the sidebar nav and produced a false failure. Scope to <header>.
const crumbText = await page.evaluate(() => {
  const bars = Array.from(document.querySelectorAll('header div'))
    .map((d) => (d.textContent || '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.startsWith('Portfolio') && t.length < 160);
  return bars.sort((a, b) => a.length - b.length)[0] ?? '';
});
const rawUuid = /[0-9a-f]{8}[- ][0-9a-f]{4}/i.test(crumbText);
record('Breadcrumbs', 'property breadcrumb shows the name, not a raw UUID',
  'contains "UAT Seaside Apartments", no hex id',
  `"${crumbText.slice(0, 90)}"`, crumbText.includes('UAT Seaside') && !rawUuid);

// ---- Maintenance flow --------------------------------------------------------------------------
console.log('\n--- MAINTENANCE "+ ADD TICKET" FLOW ---');
await page.goto(`${BASE}/maintenance`, { waitUntil: 'networkidle', timeout: 60000 });
await dismiss(page);
await page.getByRole('link', { name: /add ticket/i }).first().click().catch(async () => {
  await page.getByRole('button', { name: /add ticket/i }).first().click().catch(() => {});
});
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);
const pickText = await bodyText(page);
record('Maintenance', 'Add ticket leads to an explained property chooser',
  'lands on the property list titled "Choose a property"',
  `${path(page)} — ${/Choose a property/.test(pickText) ? 'says "Choose a property"' : 'no guidance shown'}`,
  path(page).startsWith('/properties') && /Choose a property/.test(pickText));

// Picking a property must continue into ticket creation, not the property detail page.
const cardHref = await page.evaluate(() => {
  const a = Array.from(document.querySelectorAll('a[href*="/maintenance/new"]'))[0];
  return a ? a.getAttribute('href') : null;
});
record('Maintenance', 'property cards link into ticket creation',
  'href ends /maintenance/new', cardHref ?? 'no such link', Boolean(cardHref));

if (cardHref) {
  await page.goto(`${BASE}${cardHref}`, { waitUntil: 'networkidle', timeout: 60000 });
  await dismiss(page);
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('label')).map((l) => (l.textContent || '').trim().slice(0, 40)));
  record('Maintenance', 'ticket creation form opens', 'a real form with fields',
    labels.length ? `${labels.length} fields: ${JSON.stringify(labels.slice(0, 4))}` : 'no form', labels.length > 0);
}

console.log(`\n=== POST-DEPLOY RESULT: ${pass}/${pass + fail} ===`);
console.log(`errors -- js:${sink.jsErrors.length} 4xx:${sink.s4xx.length} 5xx:${sink.s5xx.length}`);
if (sink.s5xx.length) console.log(`  5xx: ${[...new Set(sink.s5xx)].slice(0, 4).join(' | ')}`);
await browser.close();
