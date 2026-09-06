// Web <-> Android authoritative-figure parity check (V1 release-gate UAT pass).
//
// The Android owner app and the web admin app must never show different numbers for the same
// portfolio. They are separate clients, so the only thing guaranteeing agreement is that BOTH read
// the same server-computed figures rather than each deriving their own. This script proves that
// property by calling, as the same signed-in owner, the exact endpoints each client uses, and
// asserting the values are identical -- and additionally re-derives the same totals straight from
// the database, so a shared-but-wrong server value cannot pass silently.
//
// Endpoints compared (all consumed by BOTH clients today):
//   /api/v1/organizations/:orgId/financial-summary   -- web Dashboard + Android Home
//   /api/v1/properties/:id/financial-summary         -- web Property Finances + Android Property Detail
//   /api/v1/organizations/:orgId/budget/annual       -- web + Android Budget (Annual)
//   /api/v1/properties/:id/budget/annual             -- web + Android Budget (Annual, per property)
//
// LOCAL ONLY. Usage (from apps/admin/, dev server running):
//   node scripts/uat-web-android-parity.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

for (const [name, url] of [['SUPABASE_URL', SUPABASE_URL], ['APP_URL', APP_URL]]) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(url)) {
    console.error(`SAFETY: refusing to run against non-local ${name}: ${url}`);
    process.exit(1);
  }
}

const DEMO_EMAIL = 'demo-owner@proplyst-demo.local';
const DEMO_PASSWORD = 'ProplystDemo2026!';
const MONTH = process.env.UAT_MONTH ?? '2026-09-01';
const YEAR = Number(MONTH.slice(0, 4));

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const results = [];
function check(name, a, b, extra) {
  const passed = a === b;
  results.push({ name, passed });
  const detail = passed ? `${a}` : `web/api=${a}  vs  ${extra ?? 'expected'}=${b}`;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name} -- ${detail}`);
}

async function signIn() {
  const res = await fetch(`${APP_URL}/api/v1/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP_URL },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  if (!res.ok) throw new Error(`signin failed ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
}

async function api(cookie, path) {
  const res = await fetch(`${APP_URL}${path}`, { headers: { Cookie: cookie, Origin: APP_URL } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

async function main() {
  console.log(`Target: ${APP_URL} (local)   month: ${MONTH}\n`);

  const { data: org } = await admin
    .from('organizations').select('id').ilike('legal_name', 'Proplyst Demo Portfolio%').maybeSingle();
  if (!org) throw new Error('Demo portfolio org not found -- run the seed script first.');

  const cookie = await signIn();

  // The summary RPCs are SECURITY DEFINER but still gate on has_org_role(), which reads auth.uid();
  // a service-role connection has no JWT and so gets rejected. Re-derive via a genuinely signed-in
  // client -- the same authorization path the app itself uses.
  const authed = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error: signInErr } = await authed.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (signInErr) throw signInErr;

  // --- Portfolio level: the single endpoint behind both web Dashboard and Android Home ---
  const portfolio = (await api(cookie, `/api/v1/organizations/${org.id}/financial-summary?month=${MONTH}`))
    .financialSummary;

  // Re-derive the same figures independently from the database, so a shared-but-wrong value fails.
  const { data: rpc } = await authed.rpc('owner_portfolio_financial_summary', {
    p_org_id: org.id,
    p_month: MONTH,
  });
  const dbRow = Array.isArray(rpc) ? rpc[0] : rpc;

  console.log('--- Portfolio figures (web Dashboard === Android Home === database) ---');
  check('Rent planned', portfolio.rentPlanned, Number(dbRow.rent_planned), 'db');
  check('Rent collected', portfolio.rentCollected, Number(dbRow.rent_collected), 'db');
  check('Rent outstanding', portfolio.rentOutstanding, Number(dbRow.rent_outstanding), 'db');
  check('Total expenses', portfolio.totalExpenses, Number(dbRow.total_expenses), 'db');
  check('Water expense', portfolio.waterExpense, Number(dbRow.water_expense), 'db');
  check('Electricity expense', portfolio.electricityExpense, Number(dbRow.electricity_expense), 'db');
  check('Rates & taxes expense', portfolio.ratesTaxesExpense, Number(dbRow.rates_taxes_expense), 'db');
  check('Levies expense', portfolio.leviesExpense, Number(dbRow.levies_expense), 'db');
  check('Budget planned', portfolio.budgetPlanned, Number(dbRow.budget_planned), 'db');
  check('Net operating position', portfolio.netOperatingPosition, Number(dbRow.net_operating_position), 'db');
  check('Awaiting confirmation count', portfolio.awaitingConfirmationCount, Number(dbRow.awaiting_confirmation_count), 'db');
  check('Property count', portfolio.propertyCount, Number(dbRow.property_count), 'db');

  // Net operating position must be collected - expenses, not something else labelled as profit.
  check(
    'Net operating position === collected - expenses (not accounting profit)',
    portfolio.netOperatingPosition,
    portfolio.rentCollected - portfolio.totalExpenses,
    'computed',
  );

  // --- Portfolio budget must AGGREGATE property budgets, not be a competing stored total ---
  const { data: propBudgets } = await admin
    .from('property_budgets')
    .select('planned_amount, property_id, properties!inner(org_id)')
    .eq('month', MONTH)
    .eq('properties.org_id', org.id);
  const summed = (propBudgets ?? []).reduce((s, r) => s + Number(r.planned_amount), 0);
  check('Portfolio budget === SUM(property budgets)', portfolio.budgetPlanned, summed, 'sum(property_budgets)');

  // --- Property level: web Property Finances === Android Property Detail ---
  const { data: properties } = await admin
    .from('properties').select('id, nickname').eq('org_id', org.id).order('nickname');

  console.log('\n--- Per-property figures (web Property Finances === Android Property Detail) ---');
  let rentPlannedSum = 0;
  let expensesSum = 0;
  for (const p of properties) {
    const s = (await api(cookie, `/api/v1/properties/${p.id}/financial-summary?month=${MONTH}`)).financialSummary;
    const { data: prpc } = await authed.rpc('owner_financial_summary', { p_property_id: p.id, p_month: MONTH });
    const prow = Array.isArray(prpc) ? prpc[0] : prpc;
    const ok =
      s.rentPlanned === Number(prow.rent_planned) &&
      s.rentCollected === Number(prow.rent_collected) &&
      s.totalExpenses === Number(prow.total_expenses);
    results.push({ name: `${p.nickname} matches database`, passed: ok });
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${p.nickname.padEnd(28)} planned=${s.rentPlanned} collected=${s.rentCollected} expenses=${s.totalExpenses}`,
    );
    rentPlannedSum += s.rentPlanned;
    expensesSum += s.totalExpenses;
  }

  console.log('\n--- Cross-level consistency ---');
  check('SUM(property rent planned) === portfolio rent planned', rentPlannedSum, portfolio.rentPlanned, 'portfolio');
  check('SUM(property expenses) === portfolio expenses', expensesSum, portfolio.totalExpenses, 'portfolio');

  // --- Annual budget endpoints (shared DTO shape across both clients) ---
  console.log('\n--- Annual budget (shared endpoint shape) ---');
  const orgAnnual = await api(cookie, `/api/v1/organizations/${org.id}/budget/annual?year=${YEAR}`);
  check('Portfolio annual returns 12 months', orgAnnual.months.length, 12, 'expected');
  const annualSum = orgAnnual.months.reduce((s, m) => s + (m.plannedAmount ?? 0), 0);
  check('Annual planned === SUM(its own 12 months)', orgAnnual.annual.annualPlanned, annualSum, 'sum(months)');

  const firstProp = properties[0];
  const propAnnual = await api(cookie, `/api/v1/properties/${firstProp.id}/budget/annual?year=${YEAR}`);
  check('Property annual returns 12 months', propAnnual.months.length, 12, 'expected');
  check(
    'Property annual shape matches portfolio annual shape (shared Android DTO)',
    Object.keys(propAnnual.months[0]).sort().join(','),
    Object.keys(orgAnnual.months[0]).sort().join(','),
    'portfolio shape',
  );

  const failed = results.filter((r) => !r.passed);
  console.log(`\n=== PARITY RESULTS: ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length) {
    console.log('FAILURES:');
    for (const f of failed) console.log(`  - ${f.name}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
