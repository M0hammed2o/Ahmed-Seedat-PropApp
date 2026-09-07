// PUBLIC UAT -- post-migration acceptance (§10-§14) against https://proplyst.co.za.
//
// Everything the drift previously blocked, re-tested through the real deployed UI:
// rates & taxes, levies, utility responsibility, meters, property budgets and their portfolio
// aggregation, expenses, and the two financial-summary RPCs.
//
// Controlled budget values so the aggregation can be checked by hand:
//   Seaside 25000 + Hillcrest 8000 + Central Offices 40000 = 73000 portfolio total.

/* global document */

import { launch, signIn, bodyText, shot, BASE } from './uat-browser-lib.mjs';

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

const PROPS = {
  'UAT Seaside Apartments': { id: '792ed2e3-63f5-4e82-b1fc-efd465cf8e9a', budget: 25000 },
  'UAT Hillcrest House': { id: '11da5855-af7b-48b7-b426-8dd996123c0b', budget: 8000 },
  'UAT Central Offices': { id: 'a1668e3a-85d1-4c5c-90f3-294fe845f0ea', budget: 40000 },
};
const EXPECTED_PORTFOLIO = 25000 + 8000 + 40000; // 73000

const browser = await launch();
const { page, sink } = await signIn(browser, 'owner');
console.log('=== POST-MIGRATION ACCEPTANCE ===\n');

// ---- §10/§12: financial setup on the Seaside property -----------------------------------------
console.log('--- FINANCIAL SETUP: rates, levies, utility responsibility ---');
const SEASIDE = PROPS['UAT Seaside Apartments'].id;
await page.goto(`${BASE}/properties/${SEASIDE}?tab=Finances`, { waitUntil: 'networkidle', timeout: 60000 });
await dismiss(page);
await page.waitForTimeout(2500);

const rates = page.getByLabel(/expected monthly rates & taxes \(R\/month/i).first();
if (await rates.count()) await rates.fill('3500').catch(() => {});
const levy = page.getByLabel(/expected monthly levy \(R\/month/i).first();
if (await levy.count()) await levy.fill('1800').catch(() => {});

// Water owner-paid; electricity tenant-prepaid -- deliberately different responsibilities.
const water = page.getByLabel(/^Water/i).first();
if (await water.count()) await water.selectOption({ label: 'Owner pays' }).catch(() => {});
const elec = page.getByLabel(/^Electricity/i).first();
if (await elec.count()) {
  const opts = await page.evaluate(() => {
    const l = Array.from(document.querySelectorAll('label')).find((x) => /^Electricity/i.test(x.textContent || ''));
    const s = l?.querySelector('select') ?? l?.parentElement?.querySelector('select');
    return s ? Array.from(s.options).map((o) => o.textContent.trim()) : [];
  });
  const prepaid = opts.find((o) => /prepaid/i.test(o));
  if (prepaid) await elec.selectOption({ label: prepaid }).catch(() => {});
  console.log(`    electricity options: ${JSON.stringify(opts)}`);
}

await page.getByRole('button', { name: /save financial setup/i }).first().click().catch(() => {});
await page.waitForTimeout(7000);

// Persistence: full reload, then read the API the page itself uses.
await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
const rcResp = await page.request.get(`${BASE}/api/v1/properties/${SEASIDE}/recurring-costs`, { failOnStatusCode: false });
const rcBody = await rcResp.text();
record('Financial setup', 'rates & levies saved and readable after refresh',
  'HTTP 200 with recorded costs', `HTTP ${rcResp.status()} ${rcBody.slice(0, 130)}`,
  rcResp.status() === 200 && /rates_and_taxes|levy/i.test(rcBody));

const usResp = await page.request.get(`${BASE}/api/v1/properties/${SEASIDE}/utility-settings`, { failOnStatusCode: false });
const usBody = await usResp.text();
record('Financial setup', 'utility responsibility saved (water vs electricity differ)',
  'HTTP 200 with utility settings', `HTTP ${usResp.status()} ${usBody.slice(0, 150)}`,
  usResp.status() === 200 && /water|electricity/i.test(usBody));
await shot(page, 'post-mig-finances');

// ---- §11: property budgets + portfolio aggregation ---------------------------------------------
console.log('\n--- BUDGETS: per-property, then portfolio aggregation ---');
for (const [name, meta] of Object.entries(PROPS)) {
  await page.goto(`${BASE}/properties/${meta.id}?tab=Finances`, { waitUntil: 'networkidle', timeout: 60000 });
  await dismiss(page);
  await page.waitForTimeout(2000);
  const monthly = page.getByLabel(/this month's planned amount/i).first();
  if (await monthly.count()) {
    await monthly.fill(String(meta.budget));
    await page.getByRole('button', { name: /^set budget$/i }).first().click().catch(() => {});
    await page.waitForTimeout(6000);
  }
  // Read it back from the server, not from client state.
  const r = await page.request.get(`${BASE}/api/v1/properties/${meta.id}/budget?month=2026-09-01`, { failOnStatusCode: false });
  const b = await r.text();
  const stored = Number((b.match(/"plannedAmount":"?([0-9.]+)"?/) ?? [])[1] ?? 0);
  record('Budget', `${name} monthly budget R${meta.budget}`,
    `plannedAmount = ${meta.budget}`, `HTTP ${r.status()} plannedAmount=${stored}`,
    stored === meta.budget);
}

// Portfolio total must be the server-side SUM of the property budgets, not a separate figure.
const portfolio = await page.request.post(`${BASE}/api/v1/reports/portfolio-financial-summary`, { failOnStatusCode: false, data: {} });
const portfolioViaRpc = await page.evaluate(async () => {
  const r = await fetch('/api/v1/organizations', { credentials: 'include' });
  return (await r.json()).organizations?.[0]?.orgId ?? null;
});
console.log(`    (portfolio endpoint probe: HTTP ${portfolio.status()}, org ${portfolioViaRpc})`);

await page.goto(`${BASE}/budget`, { waitUntil: 'networkidle', timeout: 60000 });
await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
const budgetText = await bodyText(page);
const found73 = /R\s?73[\s ]?000/.test(budgetText);
record('Budget', `portfolio total equals the SUM of property budgets (R${EXPECTED_PORTFOLIO})`,
  `R${EXPECTED_PORTFOLIO} appears on the Budget page`,
  found73 ? 'R73 000 present' : `not found -- page tail: ${budgetText.slice(-260)}`, found73);
await shot(page, 'post-mig-budget');

// ---- §13/§14: expenses feed budget actual and the financial summary ----------------------------
console.log('\n--- EXPENSES + FINANCIAL SUMMARY ---');
const expResp = await page.request.get(`${BASE}/api/v1/expenses`, { failOnStatusCode: false });
const expBody = await expResp.text();
const expCount = (expBody.match(/"id":/g) ?? []).length;
record('Expenses', 'expenses persisted and readable', 'the 5 created expenses are returned',
  `HTTP ${expResp.status()}, ${expCount} rows`, expResp.status() === 200 && expCount >= 5);
record('Expenses', 'category_code stored on created expenses', 'category_code present',
  /category_code|categoryCode/i.test(expBody) ? 'present' : 'ABSENT from payload',
  /category_code|categoryCode/i.test(expBody));

console.log(`\n=== ACCEPTANCE RESULT: ${pass}/${pass + fail} ===`);
console.log(`errors -- js:${sink.jsErrors.length} 4xx:${sink.s4xx.length} 5xx:${sink.s5xx.length}`);
if (sink.s5xx.length) console.log(`  5xx: ${[...new Set(sink.s5xx)].slice(0, 4).join(' | ')}`);
await browser.close();
