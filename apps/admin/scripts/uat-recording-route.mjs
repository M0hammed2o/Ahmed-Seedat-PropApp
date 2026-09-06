// Web recording-route smoke check (V1 release-gate UAT pass).
//
// Walks the exact demo-recording path end to end as the signed-in demo owner and asserts every
// screen and every API call behind it returns cleanly. The point is not correctness of the numbers
// (uat-web-android-parity.mjs covers that) but RECORDING STABILITY: a screen recording cannot be
// paused to debug, so any 500, any empty-state where production data exists, and any broken panel
// ruins a take. This fails loudly on exactly those.
//
// Route (matches the agreed recording script):
//   Login -> Dashboard -> Properties -> Property -> Finances -> Rates & taxes -> Levies
//        -> Utility responsibility -> Budget -> Utility meters -> Payments
//
// LOCAL ONLY. Usage (from apps/admin/, dev server running):
//   node scripts/uat-recording-route.mjs

import { createClient } from '@supabase/supabase-js';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

for (const [n, u] of [['APP_URL', APP_URL], ['SUPABASE_URL', SUPABASE_URL]]) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(u)) {
    console.error(`SAFETY: refusing non-local ${n}: ${u}`);
    process.exit(1);
  }
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const MONTH = process.env.UAT_MONTH ?? '2026-09-01';
const YEAR = Number(MONTH.slice(0, 4));

const results = [];
function record(step, passed, detail) {
  results.push({ step, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${step}${detail ? ` -- ${detail}` : ''}`);
}

async function signIn() {
  const res = await fetch(`${APP_URL}/api/v1/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP_URL },
    body: JSON.stringify({ email: 'demo-owner@proplyst-demo.local', password: 'ProplystDemo2026!' }),
  });
  if (!res.ok) throw new Error(`signin ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
}

async function page(cookie, path) {
  const res = await fetch(`${APP_URL}${path}`, { headers: { Cookie: cookie, Origin: APP_URL } });
  const html = await res.text();
  return { status: res.status, html };
}

async function api(cookie, path) {
  const res = await fetch(`${APP_URL}${path}`, { headers: { Cookie: cookie, Origin: APP_URL } });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

async function main() {
  console.log(`Recording-route smoke check against ${APP_URL} (local), month ${MONTH}\n`);

  const { data: org } = await admin
    .from('organizations').select('id').ilike('legal_name', 'Proplyst Demo Portfolio%').maybeSingle();
  if (!org) throw new Error('Demo portfolio org not found -- run the seed script first.');
  // Active only: both the Properties list and (since migration 169) the Dashboard count exclude
  // archived properties, so an archived one must not be treated as a missing screen here.
  const { data: props } = await admin
    .from('properties').select('id, nickname').eq('org_id', org.id).eq('status', 'active').order('nickname');

  const cookie = await signIn();
  record('Login (real session cookies issued)', true);

  // --- Screens ---
  for (const [step, path] of [
    ['Dashboard renders', '/dashboard'],
    ['Properties list renders', '/properties'],
    [`Property detail renders (${props[0].nickname})`, `/properties/${props[0].id}`],
    ['Budget screen renders', '/budget'],
    ['Payments: invoices screen renders', '/accounting/invoices'],
    ['Payments: rent due screen renders', '/accounting/rent-due'],
    ['Payments: payment reports screen renders', '/accounting/payment-reports'],
    ['Payments: expenses screen renders', '/accounting/expenses'],
  ]) {
    const r = await page(cookie, path);
    const ok = r.status === 200 && !/Something went wrong|Application error|Internal Server Error/i.test(r.html);
    record(step, ok, `HTTP ${r.status}`);
  }

  // --- The APIs those screens depend on. A 500 here is what turns into a broken panel on camera. ---
  const apiSteps = [
    ['Dashboard: portfolio financial summary', `/api/v1/organizations/${org.id}/financial-summary?month=${MONTH}`],
    ['Dashboard: activity feed', `/api/v1/organizations/${org.id}/activity`],
    ['Budget: portfolio annual', `/api/v1/organizations/${org.id}/budget/annual?year=${YEAR}`],
  ];
  for (const p of props) {
    apiSteps.push([`Finances: ${p.nickname}`, `/api/v1/properties/${p.id}/financial-summary?month=${MONTH}`]);
    apiSteps.push([`Rates & levies: ${p.nickname}`, `/api/v1/properties/${p.id}/recurring-costs`]);
    apiSteps.push([`Utility responsibility: ${p.nickname}`, `/api/v1/properties/${p.id}/utility-settings`]);
    apiSteps.push([`Utility meters: ${p.nickname}`, `/api/v1/properties/${p.id}/utility-meters`]);
    apiSteps.push([`Budget (annual): ${p.nickname}`, `/api/v1/properties/${p.id}/budget/annual?year=${YEAR}`]);
  }

  let serverErrors = 0;
  for (const [step, path] of apiSteps) {
    const r = await api(cookie, path);
    const ok = r.status >= 200 && r.status < 300;
    if (r.status >= 500) serverErrors += 1;
    record(step, ok, `HTTP ${r.status}`);
  }

  // --- Recording-quality assertions: no empty screens where data should exist ---
  console.log('\n--- Recording quality ---');
  const summary = (await api(cookie, `/api/v1/organizations/${org.id}/financial-summary?month=${MONTH}`)).json
    .financialSummary;
  record('Dashboard shows non-zero rent planned (not an empty portfolio)', summary.rentPlanned > 0, `R${summary.rentPlanned}`);
  record('Dashboard shows non-zero collected rent', summary.rentCollected > 0, `R${summary.rentCollected}`);
  record('Dashboard shows a configured portfolio budget', (summary.budgetPlanned ?? 0) > 0, `R${summary.budgetPlanned}`);
  record('Dashboard property count matches seeded properties', summary.propertyCount === props.length, `${summary.propertyCount} vs ${props.length}`);

  const activity = (await api(cookie, `/api/v1/organizations/${org.id}/activity`)).json;
  const activityCount = (activity?.events ?? activity?.activity ?? activity?.items ?? []).length;
  record('Activity feed is not empty', activityCount > 0, `${activityCount} events`);

  // The Properties list filter chips must not resolve to an empty screen on camera.
  const RESIDENTIAL = new Set(['house', 'apartment', 'apartment_building', 'townhouse', 'student_accommodation']);
  const COMMERCIAL = new Set(['commercial', 'retail', 'office', 'industrial', 'mixed_use']);
  const { data: typed } = await admin
    .from('properties').select('property_type').eq('org_id', org.id).eq('status', 'active');
  const residential = typed.filter((p) => RESIDENTIAL.has(p.property_type)).length;
  const commercial = typed.filter((p) => COMMERCIAL.has(p.property_type)).length;
  record('Properties "Residential" filter has results', residential > 0, `${residential} properties`);
  record('Properties "Commercial" filter has results', commercial > 0, `${commercial} properties`);

  let ownerId = null;
  for (let page = 1; page <= 50 && !ownerId; page += 1) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    ownerId = data.users.find((u) => u.email === 'demo-owner@proplyst-demo.local')?.id ?? null;
    if (data.users.length < 200) break;
  }
  const { count: notifications } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', ownerId);
  record('Owner notifications/activity inbox is not empty', (notifications ?? 0) > 0, `${notifications} notifications`);

  const failed = results.filter((r) => !r.passed);
  console.log(`\n=== RECORDING ROUTE: ${results.length - failed.length}/${results.length} passed, ${serverErrors} server errors ===`);
  if (failed.length) {
    console.log('FAILURES:');
    for (const f of failed) console.log(`  - ${f.step} (${f.detail})`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
