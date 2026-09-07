// PUBLIC UAT -- full owner navigation sweep against https://proplyst.co.za.
//
// Visits every owner surface and records what the browser actually received: HTTP status, console
// errors, JS exceptions, and any 4xx/5xx the page fired while loading. Per the brief, an
// unexplained 5xx is a FAIL.

import { launch, signIn, path, bodyText, newSink, watch, BASE } from './uat-browser-lib.mjs';
import { writeFileSync } from 'node:fs';

const rows = [];
let pass = 0;
let fail = 0;

const SCREENS = [
  ['Dashboard', '/dashboard'],
  ['Reports', '/reports'],
  ['Properties', '/properties'],
  ['Units', '/units'],
  ['Owners', '/owners'],
  ['Tenants', '/tenants'],
  ['Leases', '/leases'],
  ['Applications', '/applications'],
  ['Maintenance', '/maintenance'],
  ['Inspections', '/inspections'],
  ['Accounting', '/accounting'],
  ['Invoices', '/accounting/invoices'],
  ['Rent Due', '/accounting/rent-due'],
  ['Expenses', '/accounting/expenses'],
  ['Budget', '/budget'],
  ['Bank Accounts', '/accounting/bank-accounts'],
  ['Bank Transactions', '/accounting/bank-transactions'],
  ['Owner Statements', '/accounting/owner-statements'],
  ['Trial Balance', '/accounting/trial-balance'],
  ['Tax Pack', '/accounting/tax-pack'],
  ['Documents', '/documents'],
  ['Notifications', '/notifications'],
  ['Announcements', '/announcements'],
  ['Settings', '/settings'],
  ['Org Billing', '/organization/billing'],
  ['Org Activity', '/organization/activity'],
  ['Org Staff', '/organization/staff'],
];

const browser = await launch();
const { page } = await signIn(browser, 'owner');

const PID = '792ed2e3-63f5-4e82-b1fc-efd465cf8e9a';
const PROPERTY_TABS = [
  ['Property detail', `/properties/${PID}`],
  ['Property edit', `/properties/${PID}/edit`],
];

console.log('=== OWNER NAVIGATION SWEEP ===\n');

let total4xx = 0;
let total5xx = 0;
let totalJs = 0;
let totalConsole = 0;

for (const [name, url] of [...SCREENS, ...PROPERTY_TABS]) {
  // A fresh sink per screen so failures are attributed to the screen that caused them.
  const sink = newSink();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: await page.context().storageState() });
  const p = await ctx.newPage();
  watch(p, sink);

  let status = 0;
  try {
    const r = await p.goto(`${BASE}${url}`, { waitUntil: 'networkidle', timeout: 60000 });
    status = r ? r.status() : 0;
    await p.waitForTimeout(1500);
  } catch (e) {
    status = -1;
    sink.jsErrors.push(`navigation: ${e.message.split('\n')[0]}`);
  }

  const landed = path(p);
  const text = await bodyText(p);
  const notFound = /404|page not found/i.test(text.slice(0, 400));
  const errorState = /something went wrong|try again|couldn't load|could not load|failed to load/i.test(text);

  total4xx += sink.s4xx.length;
  total5xx += sink.s5xx.length;
  totalJs += sink.jsErrors.length;
  totalConsole += sink.console.length;

  const ok = status === 200 && !notFound && sink.s5xx.length === 0 && sink.jsErrors.length === 0 && !errorState;
  const detail = [
    `HTTP ${status}`,
    landed !== url ? `landed ${landed}` : null,
    notFound ? 'NOT FOUND' : null,
    errorState ? 'ERROR STATE RENDERED' : null,
    sink.s5xx.length ? `${sink.s5xx.length}x5xx` : null,
    sink.s4xx.length ? `${sink.s4xx.length}x4xx` : null,
    sink.jsErrors.length ? `${sink.jsErrors.length} JS` : null,
  ].filter(Boolean).join(', ');

  rows.push({ name, url, status, landed, ok, detail, s5xx: sink.s5xx.slice(0, 3), s4xx: sink.s4xx.slice(0, 3) });
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(20)} ${detail}`);
  if (sink.s5xx.length) for (const e of sink.s5xx.slice(0, 2)) console.log(`          5xx: ${e}`);

  if (!ok) await p.screenshot({ path: `${process.env.UAT_SHOT_DIR}/sweep-${name.replace(/\W+/g, '-')}.png`, fullPage: true }).catch(() => {});
  await ctx.close();
}

console.log(`\n=== SWEEP RESULT: ${pass}/${pass + fail} screens clean ===`);
console.log(`TOTAL 4xx: ${total4xx}   TOTAL 5xx: ${total5xx}   JS errors: ${totalJs}   console errors: ${totalConsole}`);

writeFileSync(process.env.UAT_SWEEP_OUT ?? 'uat-sweep.json',
  JSON.stringify({ at: new Date().toISOString(), base: BASE, pass, fail, total4xx, total5xx, totalJs, rows }, null, 2));
await browser.close();
