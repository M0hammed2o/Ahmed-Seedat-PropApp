// Proplyst video-demo portfolio seed (V1 owner-app completion pass, WORKLOG.md this date).
//
// Creates ONE local-only, clearly-synthetic demo organisation ("Proplyst Demo Portfolio") with a
// realistic, internally-consistent 10-property / 39-unit portfolio and ~12 months of history
// (Oct 2025 - Sep 2026), so the Android owner app and the web admin app can both be recorded
// against real, server-authoritative data instead of mocks or an empty account.
//
// Property mix is deliberately varied so no UI filter or scenario resolves to an empty screen:
// freestanding houses, apartment blocks, sectional-title (levy-bearing) schemes, a townhouse
// complex, and one commercial business park (warehouse/office/retail units).
//
// SAFETY: refuses to run against anything but a local Supabase instance. Never touches production.
// Every name, address, tenant, email and phone number below is fictional -- no real pilot customer
// data, no real tenant PII, and this must never be run against a production database.
//
// Usage (from apps/admin/):
//   node scripts/seed-proplyst-video-demo.mjs            # seed (idempotent -- skips if already seeded)
//   node scripts/seed-proplyst-video-demo.mjs --reset     # wipe this demo org's data and reseed
//   node scripts/seed-proplyst-video-demo.mjs --verify-only  # only run the reconciliation report
//
// Demo login: demo-owner@proplyst-demo.local / ProplystDemo2026! (local Supabase Auth only -- this
// password only ever exists in the local demo database and is not a real secret).

import { createClient } from '@supabase/supabase-js';
import { randomUUID, createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Safety gate -- refuse anything but localhost. Never remove or weaken this check.
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  // Supabase CLI's well-known LOCAL-ONLY default demo service-role key (documented in Supabase's
  // own CLI output for every fresh `supabase start`) -- not a production secret, matches the
  // convention already used by apps/admin/tmp-create-demo-owner.mjs this session.
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const isLocalHost = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(SUPABASE_URL);
if (!isLocalHost) {
  console.error(`SAFETY: refusing to seed against a non-local Supabase URL: ${SUPABASE_URL}`);
  console.error('This script only ever runs against 127.0.0.1/localhost. Aborting.');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const RESET = args.has('--reset');
const VERIFY_ONLY = args.has('--verify-only');

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  // Supabase CLI's well-known LOCAL-ONLY default anon key -- not a production secret, same key
  // apps/android/local.properties already uses for local real-API testing this session.
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_EMAIL = 'demo-owner@proplyst-demo.local';
const DEMO_PASSWORD = 'ProplystDemo2026!';
const DEMO_ORG_NAME = 'Proplyst Demo Portfolio [INTERNAL DEMO -- not a real customer]';
const TENANT_EMAIL_DOMAIN = 'demo.proplyst.local';

// "Today" for narrative purposes -- current month is the most recent of the 12 seeded months.
const TODAY = new Date();
const CURRENT_MONTH_START = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-01`;

function monthsBack(n) {
  // 12 consecutive month-start dates ending at CURRENT_MONTH_START (index 11 = current month).
  const [y, m] = CURRENT_MONTH_START.split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`);
  }
  return out;
}
const MONTHS = monthsBack(12); // MONTHS[11] === CURRENT_MONTH_START

function fail(step, error) {
  console.error(`\n[FAILED at: ${step}]`);
  console.error(error);
  process.exit(1);
}

async function insert(table, rows, label) {
  if (rows.length === 0) return [];
  const { data, error } = await supabase.from(table).insert(rows).select('id');
  if (error) fail(`insert ${table} (${label ?? ''})`, error);
  return data;
}

function fakeChecksum(seed) {
  return createHash('sha256').update(seed).digest('hex');
}

// ---------------------------------------------------------------------------
// 1. Demo org + owner (idempotent: reuse if they already exist)
// ---------------------------------------------------------------------------
/**
 * GoTrue exposes no "get user by email", only a paginated list. A single perPage page silently
 * stops finding an existing user once the database grows past it -- this local dev database is well
 * past 200 users from months of test runs, which broke this script's idempotency outright: the
 * owner lookup missed, the script tried to re-create the account, and GoTrue rejected it with
 * email_exists. Page until found instead of assuming one page covers everything.
 */
async function findAuthUserByEmail(email) {
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail('list existing auth users', error);
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit;
    if (data.users.length < 200) return null; // last page reached
  }
  return null;
}

async function ensureDemoOrgAndOwner() {
  let userId;
  const existingUser = await findAuthUserByEmail(DEMO_EMAIL);
  if (existingUser) {
    userId = existingUser.id;
    console.log(`Reusing existing demo owner auth user: ${userId}`);
  } else {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { first_name: 'Amaan', last_name: 'Patel', phone: '0821234500' },
    });
    if (createErr) fail('create demo owner auth user', createErr);
    userId = created.user.id;
    console.log(`Created demo owner auth user: ${userId}`);
  }

  const { data: existingOrg, error: orgLookupErr } = await supabase
    .from('organizations')
    .select('id')
    .eq('legal_name', DEMO_ORG_NAME)
    .maybeSingle();
  if (orgLookupErr) fail('look up existing demo org', orgLookupErr);

  let orgId;
  if (existingOrg) {
    orgId = existingOrg.id;
    console.log(`Reusing existing demo org: ${orgId}`);
  } else {
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert({ legal_name: DEMO_ORG_NAME, org_type: 'owner_managed', status: 'active' })
      .select('id')
      .single();
    if (orgErr) fail('create demo org', orgErr);
    orgId = org.id;
    console.log(`Created demo org: ${orgId}`);

    const { error: memberErr } = await supabase.from('organization_members').insert({
      org_id: orgId,
      user_id: userId,
      role: 'principal',
      status: 'active',
      joined_at: new Date().toISOString(),
      phone: '0821234500',
    });
    if (memberErr) fail('create demo owner membership', memberErr);

    const { data: plan, error: planErr } = await supabase
      .from('plans')
      .select('id')
      .eq('code', 'business_annual')
      .single();
    if (planErr) fail('look up business_annual plan', planErr);
    const periodEnd = new Date(TODAY);
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    const { error: subErr } = await supabase.from('organization_subscriptions').insert({
      org_id: orgId,
      plan_id: plan.id,
      billing_cycle: 'annual',
      current_period_start: TODAY.toISOString().slice(0, 10),
      current_period_end: periodEnd.toISOString().slice(0, 10),
      status: 'active',
    });
    if (subErr) fail('create demo org subscription', subErr);
  }

  return { orgId, userId };
}

// ---------------------------------------------------------------------------
// 2. Reset -- wipe everything scoped to this org (children first), keep the org+user themselves.
// ---------------------------------------------------------------------------
async function resetDemoData(orgId, ownerUserId) {
  console.log(`Resetting all data for demo org ${orgId} ...`);

  // notifications is scoped by user_id, not org_id, so it cannot go in the org-scoped loop below.
  // Cleared first so a --reset re-seed produces exactly one inbox rather than stacking duplicates
  // on every run.
  {
    const { error } = await supabase.from('notifications').delete().eq('user_id', ownerUserId);
    if (error) fail('reset notifications', error);
  }

  const orderedTables = [
    // audit_events deliberately excluded -- rows are permanently immutable once written (a real,
    // trustworthy-audit-trail DB constraint). A --reset re-seed simply adds a few more activity
    // rows on top of any from a previous run rather than removing them.
    'documents',
    'maintenance_tickets',
    'budget_category_lines',
    'property_budgets',
    'utility_readings',
    'utility_meters',
    'utility_responsibility_settings',
    'recurring_property_costs',
    'expenses',
    'payment_reports',
    'invoice_payments',
    'invoices',
    'rent_schedules',
    'lease_tenants',
    'leases',
    'verified_phone_numbers',
    'tenants',
    'units',
    // properties deliberately excluded -- audit_events.property_id is a real FK, and audit_events
    // rows are permanently immutable (see above), so a property that has ever had an audited action
    // (e.g. a maintenance ticket) against it can never be deleted. seedPropertiesAndUnits() below
    // reuses existing property rows by nickname on a --reset instead of recreating them.
  ];
  for (const table of orderedTables) {
    if (table === 'lease_tenants') {
      const { data: orgLeases } = await supabase.from('leases').select('id').eq('org_id', orgId);
      const leaseIds = (orgLeases ?? []).map((l) => l.id);
      if (leaseIds.length > 0) {
        const { error } = await supabase.from('lease_tenants').delete().in('lease_id', leaseIds);
        if (error) fail(`reset ${table}`, error);
      }
      continue;
    }
    const { error } = await supabase.from(table).delete().eq('org_id', orgId);
    if (error) fail(`reset ${table}`, error);
  }
  console.log('Reset complete.');
}

// ---------------------------------------------------------------------------
// 3. Portfolio definition -- authored, not randomly generated.
// ---------------------------------------------------------------------------
const PROPERTIES = [
  {
    key: 'berea', nickname: 'Berea Heights', propertyType: 'apartment_building',
    address1: '66 Ridge Road', suburb: 'Berea', city: 'Durban', province: 'KwaZulu-Natal', postal: '4001',
    budgetPlanned: 18000, budgetIntent: 'approaching',
    utilities: { water: { mode: 'owner_paid', scope: 'property', prepaid: false, meterNumber: 'W-BH-MAIN', anomaly: true }, electricity: { mode: 'tenant_prepaid', scope: 'unit', prepaid: true } },
    recurringCosts: [{ type: 'rates_and_taxes', scope: 'property', amount: 4200 }],
    units: [
      { label: 'Unit 2A', rent: 8250, tenant: 'Nomvula Khumalo', profile: 'normal' },
      { label: 'Unit 2B', rent: 8600, tenant: 'Sipho Ndlovu', profile: 'normal' },
      { label: 'Unit 3A', rent: 7950, tenant: 'Aisha Patel', profile: 'current_overdue' },
      { label: 'Unit 3B', rent: 9100, tenant: 'Werner Botha', profile: 'normal' },
      { label: 'Unit 4A', rent: 8400, tenant: 'Thandeka Zulu', profile: 'normal' },
      { label: 'Unit 4B', rent: 8800, tenant: 'Riaan Pretorius', profile: 'normal' },
    ],
  },
  {
    key: 'morningside', nickname: 'Morningside Manor', propertyType: 'apartment_building',
    address1: '12 Manor Gardens Avenue', suburb: 'Morningside', city: 'Durban', province: 'KwaZulu-Natal', postal: '4001',
    budgetPlanned: 15000, budgetIntent: 'on_track',
    utilities: { water: { mode: 'included_in_rent', scope: 'unit', prepaid: false }, electricity: { mode: 'tenant_prepaid', scope: 'unit', prepaid: true } },
    recurringCosts: [{ type: 'rates_and_taxes', scope: 'property', amount: 3800 }],
    bigMaintenanceMonthIndex: 4, bigMaintenanceAmount: 9200, bigMaintenanceNote: 'Geyser replacement, Unit 5',
    units: [
      { label: 'Unit 1', rent: 9200, tenant: 'Lindiwe Mkhize', profile: 'normal' },
      { label: 'Unit 2', rent: 8900, tenant: 'Johan van der Merwe', profile: 'normal' },
      { label: 'Unit 3', rent: 9500, tenant: 'Zanele Dlamini', profile: 'normal' },
      { label: 'Unit 4', rent: 8750, tenant: 'Kabelo Mokoena', profile: 'normal' },
      { label: 'Unit 5', rent: 9350, tenant: 'Precious Ngcobo', profile: 'normal' },
      { label: 'Unit 6', rent: 9050, tenant: 'Andre Fourie', profile: 'normal' },
    ],
  },
  {
    key: 'musgrave', nickname: 'Musgrave Court', propertyType: 'apartment_building',
    address1: '45 Musgrave Road', suburb: 'Musgrave', city: 'Durban', province: 'KwaZulu-Natal', postal: '4001',
    budgetPlanned: 8000, budgetIntent: 'over',
    utilities: { water: { mode: 'tenant_prepaid', scope: 'unit', prepaid: true }, electricity: { mode: 'tenant_prepaid', scope: 'unit', prepaid: true } },
    recurringCosts: [{ type: 'levy', scope: 'unit', amount: 1850 }],
    units: [
      { label: 'Apt 1', rent: 11500, tenant: 'Farhana Ismail', profile: 'normal' },
      { label: 'Apt 2', rent: 10800, tenant: 'Bongani Cele', profile: 'current_partial', currentPaid: 6000 },
      { label: 'Apt 3', rent: 11200, tenant: 'Michelle Naidoo', profile: 'normal' },
      { label: 'Apt 4', rent: 10950, tenant: 'Thabo Radebe', profile: 'normal' },
    ],
  },
  {
    key: 'umhlanga', nickname: 'Umhlanga Ridge Views', propertyType: 'apartment_building',
    address1: '8 Ridge Boulevard', suburb: 'Umhlanga', city: 'Umhlanga', province: 'KwaZulu-Natal', postal: '4319',
    budgetPlanned: 25000, budgetIntent: 'on_track',
    utilities: { water: { mode: 'owner_paid', scope: 'property', prepaid: false, meterNumber: 'W-URV-MAIN', anomaly: false }, electricity: { mode: 'tenant_prepaid', scope: 'unit', prepaid: true } },
    recurringCosts: [{ type: 'rates_and_taxes', scope: 'property', amount: 5600 }],
    units: [
      { label: 'Apt 1', rent: 13400, tenant: 'Chantelle Reddy', profile: 'normal' },
      { label: 'Apt 2', rent: 12850, tenant: 'David Naidoo', profile: 'normal' },
      { label: 'Apt 3', rent: 13900, tenant: 'Nokuthula Buthelezi', profile: 'normal' },
      { label: 'Apt 4', rent: 12600, tenant: 'Marco Oliveira', profile: 'normal' },
      { label: 'Apt 5', rent: 13000, tenant: null, profile: 'vacant' },
    ],
  },
  {
    key: 'kloof', nickname: 'Kloof Hill House', propertyType: 'house',
    address1: '22 Hillcrest Avenue', suburb: 'Kloof', city: 'Kloof', province: 'KwaZulu-Natal', postal: '3610',
    budgetPlanned: 7000, budgetIntent: 'on_track',
    utilities: { water: { mode: 'owner_paid', scope: 'property', prepaid: false, meterNumber: 'W-KHH-01', anomaly: false }, electricity: { mode: 'owner_paid', scope: 'property', prepaid: false, meterNumber: 'E-KHH-01', anomaly: false } },
    recurringCosts: [{ type: 'rates_and_taxes', scope: 'property', amount: 2200 }],
    units: [{ label: 'Main House', rent: 14000, tenant: 'Priya Govender', profile: 'renewed' }],
  },
  {
    key: 'hillcrest', nickname: 'Hillcrest Family Home', propertyType: 'house',
    address1: '5 Everton Road', suburb: 'Hillcrest', city: 'Hillcrest', province: 'KwaZulu-Natal', postal: '3610',
    budgetPlanned: null, budgetIntent: 'not_configured',
    utilities: { water: { mode: 'owner_paid', scope: 'property', prepaid: false, meterNumber: 'W-HFH-01', anomaly: false }, electricity: { mode: 'owner_paid', scope: 'property', prepaid: false, meterNumber: 'E-HFH-01', anomaly: false } },
    recurringCosts: [{ type: 'rates_and_taxes', scope: 'property', amount: 2000 }],
    units: [{ label: 'Main House', rent: 13500, tenant: 'Craig Williams', profile: 'expiring_soon' }],
  },
  {
    key: 'westville', nickname: 'Westville Townhouses', propertyType: 'townhouse',
    address1: '3 Everton Close', suburb: 'Westville', city: 'Westville', province: 'KwaZulu-Natal', postal: '3629',
    budgetPlanned: 8500, budgetIntent: 'on_track',
    utilities: { water: null, electricity: { mode: 'common_area_owner', scope: 'property', prepaid: false, meterNumber: 'E-WT-COMMON', anomaly: false } },
    recurringCosts: [{ type: 'levy', scope: 'unit', amount: 950 }],
    units: [
      { label: 'Unit 1', rent: 9800, tenant: 'Ayesha Docrat', profile: 'normal' },
      { label: 'Unit 2', rent: 9400, tenant: 'Sibusiso Mahlangu', profile: 'normal' },
      { label: 'Unit 3', rent: 9650, tenant: 'Karen Botha', profile: 'normal' },
      { label: 'Unit 4', rent: 9150, tenant: 'Vusi Khoza', profile: 'normal' },
    ],
  },
  {
    key: 'glenwood', nickname: 'Glenwood Mixed Block', propertyType: 'apartment_building',
    address1: '71 Problem Free Way', suburb: 'Glenwood', city: 'Durban', province: 'KwaZulu-Natal', postal: '4001',
    budgetPlanned: 12500, budgetIntent: 'on_track',
    utilities: { water: { mode: 'included_in_rent', scope: 'unit', prepaid: false }, electricity: { mode: 'tenant_prepaid', scope: 'unit', prepaid: true } },
    recurringCosts: [{ type: 'rates_and_taxes', scope: 'property', amount: 3100 }],
    units: [
      { label: 'Unit 1', rent: 7500, tenant: 'Renee Adams', profile: 'normal' },
      { label: 'Unit 2', rent: 7850, tenant: 'Mandla Sithole', profile: 'repeat_late' },
      { label: 'Unit 3', rent: 8100, tenant: 'Fatima Vawda', profile: 'normal' },
      { label: 'Unit 4', rent: 7650, tenant: 'Grant Pillay', profile: 'normal' },
      { label: 'Unit 5', rent: 7900, tenant: null, profile: 'vacant' },
    ],
  },
  {
    key: 'ballito', nickname: 'Ballito Beach Apartments', propertyType: 'apartment_building',
    address1: '14 Compensation Beach Road', suburb: 'Ballito', city: 'Ballito', province: 'KwaZulu-Natal', postal: '4420',
    budgetPlanned: 10000, budgetIntent: 'on_track',
    utilities: { water: { mode: 'owner_paid', scope: 'property', prepaid: false, meterNumber: 'W-BBA-MAIN', anomaly: false }, electricity: { mode: 'tenant_prepaid', scope: 'unit', prepaid: true } },
    recurringCosts: [{ type: 'rates_and_taxes', scope: 'property', amount: 4100 }],
    units: [
      { label: 'Apt 1', rent: 11800, tenant: 'Tumi Maseko', profile: 'normal' },
      { label: 'Apt 2', rent: 12100, tenant: 'Charl Steyn', profile: 'normal' },
      { label: 'Apt 3', rent: 11450, tenant: 'Nozipho Mthembu', profile: 'current_awaiting' },
      { label: 'Apt 4', rent: 11950, tenant: 'Kyle Naicker', profile: 'normal' },
    ],
  },
  // Commercial: the portfolio was entirely residential until the V1 release-gate pass, which left
  // the Properties list's "Commercial" filter chip resolving to an empty screen -- bad for UAT
  // coverage and worse for demo recording. Commercial leasing differs in ways worth showing:
  // materially higher rents, higher municipal rates, owner-paid common-area utilities, and a
  // vacant unit being an ordinary (not alarming) state in a business park.
  {
    key: 'pinetown', nickname: 'Pinetown Business Park', propertyType: 'commercial',
    address1: '9 Kloof Road', suburb: 'Pinetown', city: 'Pinetown', province: 'KwaZulu-Natal', postal: '3610',
    budgetPlanned: 15000, budgetIntent: 'on_track',
    utilities: {
      water: { mode: 'owner_paid', scope: 'property', prepaid: false, meterNumber: 'W-PBP-MAIN', anomaly: false },
      electricity: { mode: 'common_area_owner', scope: 'property', prepaid: false, meterNumber: 'E-PBP-COMMON', anomaly: false },
    },
    recurringCosts: [{ type: 'rates_and_taxes', scope: 'property', amount: 6800 }],
    units: [
      { label: 'Unit A -- Warehouse', rent: 32000, tenant: 'Sizwe Ntuli', profile: 'normal' },
      { label: 'Unit B -- Office', rent: 18500, tenant: 'Deshni Pillay', profile: 'normal' },
      { label: 'Unit C -- Retail', rent: 21000, tenant: null, profile: 'vacant' },
    ],
  },
];

const PAYMENT_METHOD_CYCLE = ['eft', 'eft', 'eft', 'cash', 'eft', 'eft', 'bank_deposit', 'eft', 'eft', 'eft', 'eft', 'card'];

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 4. Properties + units
// ---------------------------------------------------------------------------
async function seedPropertiesAndUnits(orgId) {
  const { data: existingProperties, error: existingErr } = await supabase
    .from('properties').select('id, nickname').eq('org_id', orgId);
  if (existingErr) fail('load existing properties', existingErr);
  const existingByNickname = Object.fromEntries((existingProperties ?? []).map((row) => [row.nickname, row.id]));

  const newPropertyRows = [];
  for (const p of PROPERTIES) {
    if (existingByNickname[p.nickname]) {
      p.id = existingByNickname[p.nickname]; // reused across --reset (see resetDemoData's note)
    } else {
      p.id = randomUUID();
      newPropertyRows.push({
        id: p.id, org_id: orgId, nickname: p.nickname, address_line1: p.address1, suburb: p.suburb,
        city: p.city, province: p.province, postal_code: p.postal, property_type: p.propertyType, status: 'active',
      });
    }
  }
  await insert('properties', newPropertyRows, 'properties (new)');

  const unitRows = [];
  for (const p of PROPERTIES) {
    for (const u of p.units) {
      u.id = randomUUID();
      u.propertyKey = p.key;
      unitRows.push({
        id: u.id,
        property_id: p.id,
        org_id: orgId,
        unit_label: u.label,
        market_rent: u.rent,
        status: u.profile === 'vacant' ? 'vacant' : 'occupied',
      });
    }
  }
  await insert('units', unitRows, 'units');

  // Retire any property this script created previously that is no longer in the definition above
  // (e.g. one that was renamed, as "Pinetown Garden Cottage" was when it became the commercial
  // "Pinetown Business Park"). Properties are never deleted -- audit_events.property_id is a real
  // FK and those rows are permanently immutable -- so a stale one would otherwise linger as an
  // ACTIVE property with zero units, inflating the portfolio count and putting an empty, broken
  // card on screen during a demo recording. Archiving is the product's own state for exactly this,
  // and keeps active listings honest.
  const wantedNicknames = new Set(PROPERTIES.map((p) => p.nickname));
  const stale = (existingProperties ?? []).filter(
    (row) => !wantedNicknames.has(row.nickname),
  );
  if (stale.length > 0) {
    const { error } = await supabase
      .from('properties')
      .update({ status: 'archived' })
      .in('id', stale.map((s) => s.id));
    if (error) fail('archive stale demo properties', error);
    console.log(`Archived ${stale.length} stale demo propert${stale.length === 1 ? 'y' : 'ies'}: ${stale.map((s) => s.nickname).join(', ')}`);
  }

  console.log(`Seeded ${newPropertyRows.length} new properties (${PROPERTIES.length - newPropertyRows.length} reused), ${unitRows.length} units.`);
}

// ---------------------------------------------------------------------------
// 5. Tenants, leases, lease_tenants, rent_schedules, invoices, invoice_payments, payment_reports
// ---------------------------------------------------------------------------
async function seedTenanciesAndRent(orgId, ownerUserId) {
  const tenantRows = [];
  const leaseRows = [];
  const leaseTenantRows = [];
  const rentScheduleRows = [];
  const invoiceRows = [];
  const invoicePaymentRows = [];
  const paymentReportRows = [];

  let phoneCounter = 100;

  for (const p of PROPERTIES) {
    for (const u of p.units) {
      if (u.profile === 'vacant') continue;
      phoneCounter += 1;
      const slug = u.tenant.toLowerCase().replace(/[^a-z]+/g, '.');
      const tenantId = randomUUID();
      u.tenantId = tenantId;
      tenantRows.push({
        id: tenantId,
        org_id: orgId,
        full_name: u.tenant,
        email: `${slug}@${TENANT_EMAIL_DOMAIN}`,
        phone: `082 555 ${String(phoneCounter).padStart(4, '0')}`,
        status: 'active',
      });

      if (u.profile === 'renewed') {
        // Same tenant, two consecutive leases: an expired one covering months 0-9, a new (renewed)
        // one covering months 10-11 -- a genuine renewal, not a single lease pretending to be new.
        const oldLeaseId = randomUUID();
        const newLeaseId = randomUUID();
        leaseRows.push(
          { id: oldLeaseId, org_id: orgId, unit_id: u.id, start_date: '2023-01-01', end_date: addDays(MONTHS[10], -1), rent_amount: u.rent, rent_frequency: 'monthly', deposit_amount: u.rent, status: 'expired', source: 'manual' },
          { id: newLeaseId, org_id: orgId, unit_id: u.id, start_date: MONTHS[10], end_date: null, rent_amount: u.rent, rent_frequency: 'monthly', deposit_amount: u.rent, status: 'active', source: 'manual' },
        );
        leaseTenantRows.push({ lease_id: oldLeaseId, tenant_id: tenantId, is_primary: true }, { lease_id: newLeaseId, tenant_id: tenantId, is_primary: true });
        u.leaseId = newLeaseId;
        u.leaseByMonth = MONTHS.map((_, i) => (i < 10 ? oldLeaseId : newLeaseId));
      } else {
        const leaseId = randomUUID();
        const endDate = u.profile === 'expiring_soon' ? addDays(CURRENT_MONTH_START, 55) : null;
        leaseRows.push({ id: leaseId, org_id: orgId, unit_id: u.id, start_date: '2023-06-01', end_date: endDate, rent_amount: u.rent, rent_frequency: 'monthly', deposit_amount: u.rent, status: 'active', source: 'manual' });
        leaseTenantRows.push({ lease_id: leaseId, tenant_id: tenantId, is_primary: true });
        u.leaseId = leaseId;
        u.leaseByMonth = MONTHS.map(() => leaseId);
      }

      MONTHS.forEach((month, monthIndex) => {
        const leaseId = u.leaseByMonth[monthIndex];
        const scheduleId = randomUUID();
        const isCurrent = monthIndex === MONTHS.length - 1;
        const isLateProfile = u.profile === 'repeat_late' && [1, 3, 5, 7].includes(monthIndex);

        let status = 'paid';
        let paymentAmount = u.rent;
        let paidAt = addDays(month, isLateProfile ? 12 : monthIndex % 4);
        let createInvoicePayment = true;
        let createPaymentReport = false;

        if (isCurrent) {
          if (u.profile === 'current_overdue') {
            status = 'overdue';
            createInvoicePayment = false;
          } else if (u.profile === 'current_partial') {
            status = 'partial';
            paymentAmount = u.currentPaid;
          } else if (u.profile === 'current_awaiting') {
            status = 'invoiced';
            createInvoicePayment = false;
            createPaymentReport = true;
          } else {
            paidAt = addDays(month, 3);
          }
        }

        rentScheduleRows.push({ id: scheduleId, org_id: orgId, lease_id: leaseId, due_date: month, amount: u.rent, status });

        const invoiceId = randomUUID();
        invoiceRows.push({
          id: invoiceId, org_id: orgId, lease_id: leaseId, tenant_id: tenantId, period: month, amount: u.rent,
          status: 'issued', issued_at: `${month}T08:00:00Z`, source: 'rent_schedule',
        });

        if (createInvoicePayment) {
          invoicePaymentRows.push({
            id: randomUUID(), invoice_id: invoiceId, amount: paymentAmount, paid_at: paidAt,
            method: PAYMENT_METHOD_CYCLE[monthIndex], recorded_by: ownerUserId, org_id: orgId, tenant_id: tenantId,
            reference: `RENT-${u.label.replace(/\s+/g, '')}-${month.slice(0, 7).replace('-', '')}`,
          });
        }
        if (createPaymentReport) {
          paymentReportRows.push({
            id: randomUUID(), org_id: orgId, property_id: p.id, lease_id: leaseId, rent_schedule_id: scheduleId,
            tenant_id: tenantId, reported_by_tenant: false, reported_by_user_id: ownerUserId,
            amount: u.rent, payment_method: 'eft', payment_date: addDays(month, 4), status: 'reported',
          });
        }
      });
    }
  }

  await insert('tenants', tenantRows, 'tenants');
  await insert('leases', leaseRows, 'leases');
  { const { error } = await supabase.from('lease_tenants').insert(leaseTenantRows); if (error) fail('insert lease_tenants', error); }
  await insert('rent_schedules', rentScheduleRows, 'rent_schedules');
  await insert('invoices', invoiceRows, 'invoices');
  await insert('invoice_payments', invoicePaymentRows, 'invoice_payments');
  await insert('payment_reports', paymentReportRows, 'payment_reports');

  console.log(`Seeded ${tenantRows.length} tenants, ${leaseRows.length} leases, ${rentScheduleRows.length} rent schedules, ${invoiceRows.length} invoices, ${invoicePaymentRows.length} payments, ${paymentReportRows.length} payment reports.`);
}

// ---------------------------------------------------------------------------
// 6. Expenses (12 months per property) -- tuned so the CURRENT month reflects each property's
//    intended budget status (on_track/approaching/over/not_configured).
// ---------------------------------------------------------------------------
const BUDGET_RATIO = { on_track: 0.65, approaching: 0.86, over: 1.18, not_configured: 0.7 };

async function seedExpenses(orgId) {
  const expenseRows = [];
  const exp = (property, month, category, categoryCode, amount) => ({
    id: randomUUID(),
    org_id: orgId,
    property_id: property.id,
    category,
    category_code: categoryCode,
    amount: Math.max(0, Math.round(amount)),
    status: 'pending',
    invoice_date: month,
  });

  for (const p of PROPERTIES) {
    const rates = p.recurringCosts.find((c) => c.type === 'rates_and_taxes');
    const levy = p.recurringCosts.find((c) => c.type === 'levy');
    const occupiedUnits = p.units.filter((u) => u.profile !== 'vacant');
    const ratesMonthlyTotal = rates ? rates.amount : 0;
    const levyMonthlyTotal = levy ? levy.amount * occupiedUnits.length : 0;

    // A small, proportionate maintenance/other baseline so the property doesn't look neglected,
    // then a top-up line (category "other" via management/insurance-style overhead) that brings the
    // CURRENT month to the intended budget ratio without inflating every other month artificially.
    const routineMaintenance = Math.round((p.budgetPlanned ?? 4000) * 0.04);
    const managementFee = Math.round(occupiedUnits.reduce((sum, u) => sum + u.rent, 0) * 0.02);

    MONTHS.forEach((month, monthIndex) => {
      const isCurrent = monthIndex === MONTHS.length - 1;
      if (ratesMonthlyTotal > 0) {
        expenseRows.push(exp(p, month, 'Municipal rates and taxes', 'rates_taxes', ratesMonthlyTotal));
      }
      if (levyMonthlyTotal > 0) {
        expenseRows.push(exp(p, month, 'Body corporate levy', 'levies', levyMonthlyTotal));
      }
      if (p.utilities.water?.mode === 'owner_paid') {
        const base = p.propertyType === 'house' ? 650 : 1850;
        expenseRows.push(exp(p, month, 'Municipal water account', 'water', base + (monthIndex % 3) * 60));
      }
      if (p.utilities.electricity?.mode === 'owner_paid' || p.utilities.electricity?.mode === 'common_area_owner') {
        const base = p.propertyType === 'house' ? 850 : 620;
        expenseRows.push(exp(p, month, 'Municipal electricity account', 'electricity', base + (monthIndex % 4) * 40));
      }
      expenseRows.push(exp(p, month, 'Routine maintenance', 'maintenance', routineMaintenance));
      if (managementFee > 0) expenseRows.push(exp(p, month, 'Portfolio management fee', 'management', managementFee));

      if (p.bigMaintenanceMonthIndex === monthIndex) {
        expenseRows.push(exp(p, month, p.bigMaintenanceNote, 'maintenance', p.bigMaintenanceAmount));
      }

      if (isCurrent && p.budgetPlanned != null) {
        const target = p.budgetPlanned * BUDGET_RATIO[p.budgetIntent];
        const soFar = expenseRows.filter((e) => e.property_id === p.id && e.invoice_date === month).reduce((s, e) => s + e.amount, 0);
        const topUp = Math.round(target - soFar);
        if (topUp > 50) expenseRows.push(exp(p, month, 'Cleaning and general upkeep', 'cleaning', topUp));
      }
    });
  }

  await insert('expenses', expenseRows, 'expenses');
  console.log(`Seeded ${expenseRows.length} expense line items across 12 months.`);
}

// ---------------------------------------------------------------------------
// 7. Recurring property costs (the "expected" figures, distinct from actual expenses above)
// ---------------------------------------------------------------------------
async function seedRecurringCosts(orgId, ownerUserId) {
  const rows = [];
  for (const p of PROPERTIES) {
    for (const cost of p.recurringCosts) {
      if (cost.scope === 'property') {
        rows.push({ id: randomUUID(), org_id: orgId, property_id: p.id, unit_id: null, cost_type: cost.type, amount: cost.amount, effective_from: '2025-01-01', created_by: ownerUserId });
      } else {
        for (const u of p.units) {
          if (u.profile === 'vacant') continue;
          rows.push({ id: randomUUID(), org_id: orgId, property_id: p.id, unit_id: u.id, cost_type: cost.type, amount: cost.amount, effective_from: '2025-01-01', created_by: ownerUserId });
        }
      }
    }
  }
  await insert('recurring_property_costs', rows, 'recurring_property_costs');
  console.log(`Seeded ${rows.length} recurring property cost rows.`);
}

// ---------------------------------------------------------------------------
// 8. Utilities: responsibility settings, meters, and 12 months of readings (one deliberate
//    anomaly, one deliberately normal meter).
// ---------------------------------------------------------------------------
async function seedUtilities(orgId) {
  const settingRows = [];
  const meterRows = [];
  const readingRows = [];

  for (const p of PROPERTIES) {
    for (const utilityType of ['water', 'electricity']) {
      const config = p.utilities[utilityType];
      if (!config) continue; // "No meter configured" case, deliberately left empty (Westville water, Pinetown both)

      if (config.scope === 'property') {
        settingRows.push({ id: randomUUID(), org_id: orgId, property_id: p.id, unit_id: null, utility_type: utilityType, responsibility_mode: config.mode, active: true });
        const meterId = randomUUID();
        meterRows.push({ id: meterId, org_id: orgId, property_id: p.id, unit_id: null, utility_type: utilityType, meter_number: config.meterNumber, responsibility_mode: config.mode, is_prepaid: config.prepaid, active: true, installed_date: '2024-01-01' });
        pushReadings(readingRows, orgId, meterId, utilityType, config.anomaly);
      } else {
        for (const u of p.units) {
          if (u.profile === 'vacant') continue;
          settingRows.push({ id: randomUUID(), org_id: orgId, property_id: p.id, unit_id: u.id, utility_type: utilityType, responsibility_mode: config.mode, active: true });
          if (config.mode === 'tenant_prepaid') {
            const meterId = randomUUID();
            meterRows.push({ id: meterId, org_id: orgId, property_id: p.id, unit_id: u.id, utility_type: utilityType, meter_number: `${utilityType === 'water' ? 'W' : 'E'}-${u.label.replace(/\s+/g, '')}`, responsibility_mode: config.mode, is_prepaid: true, active: true, installed_date: '2024-01-01' });
            // Tenant-prepaid meters: the owner has no readings to take (the tenant tops up
            // directly) -- deliberately left with zero reading history, matching real practice.
          }
        }
      }
    }
  }

  await insert('utility_responsibility_settings', settingRows, 'utility_responsibility_settings');
  await insert('utility_meters', meterRows, 'utility_meters');
  await insert('utility_readings', readingRows, 'utility_readings');
  console.log(`Seeded ${settingRows.length} utility responsibility settings, ${meterRows.length} meters, ${readingRows.length} readings.`);
}

function pushReadings(readingRows, orgId, meterId, utilityType, anomaly) {
  const unitOfMeasure = utilityType === 'water' ? 'L' : 'kWh';
  // 11 months of gently-varying "normal" consumption, then either a deliberate August->September
  // jump (>=20% AND >=200L, comfortably past ANOMALY_PERCENT_THRESHOLD/ANOMALY_MIN_ABSOLUTE_INCREASE
  // in apps/admin/lib/utilityAnomaly.ts) or a continued-normal final month.
  const baseline = utilityType === 'water' ? 950 : 310;
  const noise = utilityType === 'water' ? [0, 30, -20, 40, -10, 20, -30, 50, -15, 25, 10] : [0, 12, -8, 15, -5, 10, -12, 18, -6, 9, 4];
  let previousReading = 4000; // arbitrary meter starting point, never shown directly, only consumption matters
  let previousConsumption = null;

  MONTHS.forEach((month, i) => {
    let consumption;
    if (anomaly && i === MONTHS.length - 1) {
      consumption = Math.round(previousConsumption * 1.28); // ~28% jump, well past the 20%/200L floor
    } else if (anomaly && i === MONTHS.length - 2) {
      consumption = 1000; // the "before" reading the spec's own example uses
    } else {
      consumption = baseline + noise[i % noise.length];
    }
    const readingValue = previousReading + consumption;
    readingRows.push({
      id: randomUUID(), org_id: orgId, meter_id: meterId, period_month: month, reading_date: addDays(month, 26),
      reading_value: readingValue, consumption, unit_of_measure: unitOfMeasure, source: 'manual',
    });
    previousReading = readingValue;
    previousConsumption = consumption;
  });
}

// ---------------------------------------------------------------------------
// 9. Property budgets (monthly, all 12 months) + annual rollup is a pure sum -- nothing extra to seed.
// ---------------------------------------------------------------------------
async function seedBudgets(orgId, ownerUserId) {
  const rows = [];
  for (const p of PROPERTIES) {
    if (p.budgetPlanned == null) continue; // "Not configured" -- Hillcrest, deliberately
    MONTHS.forEach((month) => {
      rows.push({ id: randomUUID(), org_id: orgId, property_id: p.id, month, planned_amount: p.budgetPlanned, created_by: ownerUserId });
    });
  }
  await insert('property_budgets', rows, 'property_budgets');
  console.log(`Seeded ${rows.length} monthly property budget rows.`);
}

// ---------------------------------------------------------------------------
// 10. Maintenance tickets (auto-audited -- these alone will appear on Activity without extra work)
// ---------------------------------------------------------------------------
async function seedMaintenance(orgId, ownerUserId) {
  const byKey = Object.fromEntries(PROPERTIES.map((p) => [p.key, p]));
  const rows = [
    { property: 'berea', unit: 'Unit 3B', summary: 'Leaking tap in kitchen', priority: 'low', status: 'completed', resolved: true },
    { property: 'morningside', unit: 'Unit 5', summary: 'Geyser service and replacement', priority: 'medium', status: 'completed', resolved: true },
    { property: 'westville', unit: null, summary: 'Gate motor repair', priority: 'medium', status: 'completed', resolved: true },
    { property: 'glenwood', unit: null, summary: 'Common area repainting', priority: 'low', status: 'in_progress', resolved: false },
    { property: 'hillcrest', unit: 'Main House', summary: 'Bathroom leak -- inspection requested', priority: 'medium', status: 'to_do', resolved: false },
    { property: 'ballito', unit: 'Apt 4', summary: 'Electrical fault -- urgent, tenant reports sparking outlet', priority: 'urgent', status: 'to_do', resolved: false },
  ];
  const insertRows = rows.map((r) => {
    const property = byKey[r.property];
    const unit = r.unit ? property.units.find((u) => u.label === r.unit) : null;
    return {
      id: randomUUID(), org_id: orgId, property_id: property.id, unit_id: unit?.id ?? null,
      submitted_by_user_id: ownerUserId, summary: r.summary, priority: r.priority, status: r.status,
      resolved_at: r.resolved ? addDays(CURRENT_MONTH_START, -10) : null,
    };
  });
  await insert('maintenance_tickets', insertRows, 'maintenance_tickets');
  console.log(`Seeded ${insertRows.length} maintenance tickets.`);
}

// ---------------------------------------------------------------------------
// 11. Documents -- safe placeholder fixtures, never fabricated real legal documents.
// ---------------------------------------------------------------------------
async function seedDocuments(orgId, ownerUserId) {
  const { data: categories, error } = await supabase.from('document_categories').select('id, slug').eq('is_default', true);
  if (error) fail('load document_categories', error);
  const categoryId = Object.fromEntries(categories.map((c) => [c.slug, c.id]));

  const rows = [];
  let seq = 0;
  function doc(property, slug, documentType, fileName, extra = {}) {
    seq += 1;
    const storagePath = `demo-seed/${property.key}/${seq}-${fileName.replace(/\s+/g, '-').toLowerCase()}`;
    rows.push({
      id: randomUUID(), org_id: orgId, property_id: property.id, category_id: categoryId[slug],
      document_type: documentType, storage_path: storagePath, original_file_name: fileName,
      mime_type: 'application/pdf', file_size_bytes: 180000 + seq * 1000, checksum_sha256: fakeChecksum(storagePath),
      uploaded_by: ownerUserId, ...extra,
    });
  }

  for (const p of PROPERTIES) {
    const occupied = p.units.filter((u) => u.profile !== 'vacant');
    if (occupied[0]) {
      doc(p, 'rental_documents', 'lease', `Lease Agreement - ${occupied[0].label}.pdf`, { lease_id: occupied[0].leaseId, tenant_id: occupied[0].tenantId, unit_id: occupied[0].id });
    }
    if (p.recurringCosts.some((c) => c.type === 'rates_and_taxes')) {
      doc(p, 'rates_and_taxes', 'statement', `Rates Statement - ${p.nickname}.pdf`, { billing_year: 2026, billing_month: 9 });
    }
    if (p.recurringCosts.some((c) => c.type === 'levy')) {
      doc(p, 'levies', 'statement', `Levy Statement - ${p.nickname}.pdf`, { billing_year: 2026, billing_month: 9 });
    }
    if (p.utilities.water?.mode === 'owner_paid') {
      doc(p, 'water', 'bill', `Water Bill - ${p.nickname}.pdf`, { billing_year: 2026, billing_month: 9 });
    }
    if (p.utilities.electricity?.mode === 'owner_paid' || p.utilities.electricity?.mode === 'common_area_owner') {
      doc(p, 'electricity', 'bill', `Electricity Bill - ${p.nickname}.pdf`, { billing_year: 2026, billing_month: 9 });
    }
  }
  doc(byKeyDoc('hillcrest'), 'inspections', 'other', 'Move-in Inspection Report - Hillcrest Family Home.pdf');
  function byKeyDoc(key) { return PROPERTIES.find((p) => p.key === key); }

  await insert('documents', rows, 'documents');
  console.log(`Seeded ${rows.length} document fixtures.`);
}

// ---------------------------------------------------------------------------
// 12. Manual audit_events for the RPC-only actions our direct inserts bypassed, so Activity shows
//     a realistic mix without a second, fake activity-log table.
// ---------------------------------------------------------------------------
async function seedActivity(orgId, ownerUserId) {
  const rows = [
    { action: 'property_budget.set', entity_type: 'property_budgets' },
    { action: 'recurring_property_cost.set', entity_type: 'recurring_property_costs' },
    { action: 'utility_reading.recorded', entity_type: 'utility_readings' },
  ].map((r) => ({
    id: randomUUID(), org_id: orgId, actor_type: 'user', actor_user_id: ownerUserId,
    action: r.action, entity_type: r.entity_type, entity_id: randomUUID(),
    actor_role: 'principal', actor_display_name: 'Amaan Patel',
  }));
  await insert('audit_events', rows, 'audit_events');
  console.log(`Seeded ${rows.length} additional activity events (maintenance tickets are auto-logged separately).`);
}

// ---------------------------------------------------------------------------
// 12b. In-app notifications for the owner.
//
// The Android "Activity" tab and the web notifications bell read public.notifications, which is a
// DIFFERENT table from the audit_events feed seeded above -- a distinction the V1 release-gate pass
// surfaced when Activity rendered "No notifications yet" against an otherwise fully-populated demo
// portfolio. That empty screen is a recording-readiness defect, so the owner gets a realistic inbox
// here. Each notification corresponds to a real seeded condition (the same seven items that drive
// Needs Attention), so the feed stays truthful rather than decorative: every row below is something
// the data genuinely supports.
// ---------------------------------------------------------------------------
/**
 * UAT-ONLY inbound WhatsApp phone mapping.
 *
 * Inbound resolution (WHATSAPP.md §1.2, resolve_whatsapp_sender()) is fully built: a sender number
 * is looked up in verified_phone_numbers, where 0 matches = UNAUTHENTICATED, exactly 1 = RESOLVED,
 * and 2+ = AMBIGUOUS (never guessed between). The only thing missing in V1 is a way to POPULATE
 * that table: the OTP verification flow that would normally write it is undesigned, so in practice
 * every real inbound message resolves to 0 matches and can never reach a tenant context.
 *
 * That makes inbound impossible to exercise in UAT without seeding the mapping directly, which is
 * what this does -- for the demo organisation only, in a script that refuses to run anywhere but
 * localhost. It is NOT an OTP flow and must never be mistaken for one: verification_method is left
 * at its 'otp' default because the column's CHECK permits nothing else, so these rows are flagged
 * as UAT purely by belonging to the demo org.
 *
 * The number is the UAT destination handset. Mapping it to ONE demo tenant is deliberate: it makes
 * a real inbound message from that phone resolve to exactly one tenant (RESOLVED), which is the
 * branch worth demonstrating. Mapping it to several would produce AMBIGUOUS and prove less.
 *
 * No tenant record is altered -- tenants.phone keeps its own fictional demo number. This table is a
 * separate identity mapping, so seeding it changes nothing about the tenant's own data.
 */
const UAT_INBOUND_PHONE_E164 = process.env.WHATSAPP_UAT_OVERRIDE_NUMBER ?? '+27837866021';

async function seedUatInboundPhoneMapping(orgId) {
  if (!/^\+[1-9]\d{6,14}$/.test(UAT_INBOUND_PHONE_E164)) {
    console.log(`Skipped UAT inbound phone mapping -- ${UAT_INBOUND_PHONE_E164} is not valid E.164.`);
    return;
  }

  // The primary tenant of the first occupied unit -- a stable, meaningful choice for a demo.
  const anchor = PROPERTIES.flatMap((p) => p.units).find((u) => u.profile !== 'vacant' && u.tenantId);
  if (!anchor) {
    console.log('Skipped UAT inbound phone mapping -- no occupied unit with a tenant was seeded.');
    return;
  }

  const { error } = await supabase.from('verified_phone_numbers').insert({
    org_id: orgId,
    entity_type: 'tenant',
    entity_id: anchor.tenantId,
    phone_number_e164: UAT_INBOUND_PHONE_E164,
  });
  if (error) fail('seed UAT inbound phone mapping', error);

  console.log(
    `Seeded UAT inbound phone mapping: ${UAT_INBOUND_PHONE_E164} -> tenant "${anchor.tenant}" (${anchor.label}).`,
  );
  console.log('  An inbound WhatsApp from that handset now resolves to exactly this tenant (RESOLVED).');
}

async function seedNotifications(orgId, ownerUserId) {
  const byKey = Object.fromEntries(PROPERTIES.map((p) => [p.key, p]));
  const overdueUnit = byKey.berea.units.find((u) => u.profile === 'current_overdue');
  const awaitingUnit = byKey.ballito.units.find((u) => u.profile === 'current_awaiting');
  const partialUnit = byKey.musgrave.units.find((u) => u.profile === 'current_partial');

  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

  const rows = [
    {
      type: 'rent_overdue',
      title: 'Rent overdue',
      body: `${overdueUnit.tenant} (${byKey.berea.nickname}, ${overdueUnit.label}) has not paid R ${overdueUnit.rent.toLocaleString('en-ZA')} for September.`,
      created_at: daysAgo(1),
    },
    {
      type: 'payment_confirmation_required',
      title: 'Payment awaiting your confirmation',
      body: `${awaitingUnit.tenant} reported an EFT of R ${awaitingUnit.rent.toLocaleString('en-ZA')} for ${byKey.ballito.nickname}, ${awaitingUnit.label}. Confirm once the funds reflect.`,
      created_at: daysAgo(1),
    },
    {
      type: 'rent_partial',
      title: 'Partial rent received',
      body: `${partialUnit.tenant} paid R ${partialUnit.currentPaid.toLocaleString('en-ZA')} of R ${partialUnit.rent.toLocaleString('en-ZA')} for ${byKey.musgrave.nickname}, ${partialUnit.label}.`,
      created_at: daysAgo(2),
      read_at: daysAgo(1),
    },
    {
      type: 'budget_exceeded',
      title: 'Over budget',
      body: `${byKey.musgrave.nickname} has exceeded its monthly budget of R ${byKey.musgrave.budgetPlanned.toLocaleString('en-ZA')}.`,
      created_at: daysAgo(3),
    },
    {
      type: 'budget_approaching',
      title: 'Approaching budget',
      body: `${byKey.berea.nickname} has used most of its R ${byKey.berea.budgetPlanned.toLocaleString('en-ZA')} monthly budget.`,
      created_at: daysAgo(4),
      read_at: daysAgo(3),
    },
    {
      type: 'utility_unusual_usage',
      title: 'Unusual water usage',
      body: `Water usage at ${byKey.berea.nickname} is higher than usual this month. Consider checking for leaks or unusual consumption.`,
      created_at: daysAgo(5),
    },
    {
      type: 'maintenance_update',
      title: 'Urgent maintenance reported',
      body: `An electrical fault was reported at ${byKey.ballito.nickname}, Apt 4.`,
      created_at: daysAgo(6),
    },
    {
      type: 'lease_expiring',
      title: 'Lease expiring soon',
      body: `The lease at ${byKey.hillcrest.nickname} ends within the next 60 days.`,
      created_at: daysAgo(7),
      read_at: daysAgo(6),
    },
  ].map((n) => ({
    id: randomUUID(),
    user_id: ownerUserId,
    type: n.type,
    title: n.title,
    body: n.body,
    read_at: n.read_at ?? null,
    created_at: n.created_at,
  }));

  await insert('notifications', rows, 'notifications');
  console.log(`Seeded ${rows.length} owner notifications (${rows.filter((r) => !r.read_at).length} unread).`);
}

// ---------------------------------------------------------------------------
// 13. Reconciliation report -- verify, don't assume.
// ---------------------------------------------------------------------------
async function verify(orgId) {
  console.log('\n=== RECONCILIATION REPORT ===');

  // owner_portfolio_financial_summary()/budget_vs_actual() are SECURITY DEFINER but still check
  // has_org_role(), which reads auth.uid() -- a service-role connection has none. Sign in as the
  // real demo owner (exactly how the app itself calls these) so the RPCs authorize normally.
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: signIn, error: signInErr } = await authClient.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  if (signInErr) fail('verify: sign in as demo owner', signInErr);
  console.log(`Signed in as demo owner for verification (session user: ${signIn.user.id}).`);

  const { data: portfolio, error: pErr } = await authClient.rpc('owner_portfolio_financial_summary', { p_org_id: orgId, p_month: CURRENT_MONTH_START }).maybeSingle();
  if (pErr) fail('verify: owner_portfolio_financial_summary', pErr);
  console.log(`Current month: ${CURRENT_MONTH_START}`);
  console.log(`Rent planned:      R ${Number(portfolio.rent_planned).toFixed(2)}`);
  console.log(`Rent collected:    R ${Number(portfolio.rent_collected).toFixed(2)} (${((portfolio.rent_collected / portfolio.rent_planned) * 100).toFixed(1)}%)`);
  console.log(`Rent outstanding:  R ${Number(portfolio.rent_outstanding).toFixed(2)}`);
  console.log(`Total expenses:    R ${Number(portfolio.total_expenses).toFixed(2)}`);
  console.log(`Budget planned:    R ${Number(portfolio.budget_planned).toFixed(2)}`);
  console.log(`Budget used:       ${portfolio.budget_used_percent}%`);
  console.log(`Net operating position: R ${Number(portfolio.net_operating_position).toFixed(2)}`);
  console.log(`Awaiting confirmation count: ${portfolio.awaiting_confirmation_count}`);
  console.log(`Property count: ${portfolio.property_count}`);

  const sumOfPropertyBudgets = PROPERTIES.filter((p) => p.budgetPlanned != null).reduce((s, p) => s + p.budgetPlanned, 0);
  const portfolioBudgetOk = Number(portfolio.budget_planned) === sumOfPropertyBudgets;
  console.log(`\nPortfolio budget = sum(property budgets)? ${portfolioBudgetOk ? 'YES' : 'NO'} (expected ${sumOfPropertyBudgets}, got ${portfolio.budget_planned})`);

  const { count: unitCount } = await supabase.from('units').select('id', { count: 'exact', head: true }).eq('org_id', orgId);
  const { count: occupiedCount } = await supabase.from('units').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'occupied');
  console.log(`\nUnits: ${unitCount} total, ${occupiedCount} occupied, ${unitCount - occupiedCount} vacant (${((occupiedCount / unitCount) * 100).toFixed(1)}% occupancy)`);

  // `--verify-only` runs standalone (no prior seeding call in this process), so PROPERTIES[].id
  // is never populated in memory -- always resolve ids from the DB by nickname instead.
  const { data: dbProperties, error: propErr } = await supabase.from('properties').select('id, nickname').eq('org_id', orgId);
  if (propErr) fail('verify: load properties', propErr);
  const propertyIdByNickname = Object.fromEntries(dbProperties.map((row) => [row.nickname, row.id]));

  let statusMismatches = 0;
  for (const p of PROPERTIES) {
    const propertyId = propertyIdByNickname[p.nickname];
    const { data: budgetVsActual, error: bErr } = await authClient.rpc('budget_vs_actual', { p_property_id: propertyId, p_month: CURRENT_MONTH_START }).maybeSingle();
    if (bErr) fail(`verify: budget_vs_actual for ${p.nickname}`, bErr);
    const percentUsed = budgetVsActual?.percent_used == null ? null : Number(budgetVsActual.percent_used);
    let actualStatus;
    if (p.budgetPlanned == null) actualStatus = percentUsed == null ? 'not_configured' : 'MISMATCH:has_budget';
    else if (percentUsed >= 100) actualStatus = 'over';
    else if (percentUsed >= 80) actualStatus = 'approaching';
    else actualStatus = 'on_track';
    const ok = actualStatus === p.budgetIntent;
    if (!ok) statusMismatches += 1;
    console.log(`  ${p.nickname}: intended=${p.budgetIntent}, actual=${actualStatus}, percentUsed=${percentUsed} ${ok ? '' : '<-- MISMATCH'}`);
  }

  const { count: negativeBalances } = await supabase.from('invoice_payments').select('id', { count: 'exact', head: true }).lt('amount', 0);
  console.log(`\nNegative payment amounts (should be 0): ${negativeBalances}`);

  console.log(`\nStatus mismatches: ${statusMismatches}`);
  console.log(statusMismatches === 0 ? 'RECONCILIATION: PASS' : 'RECONCILIATION: NEEDS ADJUSTMENT');
  return statusMismatches === 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Seeding against: ${SUPABASE_URL} (confirmed local)`);
  console.log(`Current/latest seeded month: ${CURRENT_MONTH_START}`);

  const { orgId, userId } = await ensureDemoOrgAndOwner();

  if (VERIFY_ONLY) {
    await verify(orgId);
    return;
  }

  const { count: existingPropertyCount } = await supabase.from('properties').select('id', { count: 'exact', head: true }).eq('org_id', orgId);
  if (existingPropertyCount > 0 && !RESET) {
    console.log(`\nDemo org already has ${existingPropertyCount} properties seeded. Re-run with --reset to wipe and reseed. Running verification only.`);
    await verify(orgId);
    return;
  }
  if (RESET) await resetDemoData(orgId, userId);

  await seedPropertiesAndUnits(orgId);
  await seedTenanciesAndRent(orgId, userId);
  await seedExpenses(orgId);
  await seedRecurringCosts(orgId, userId);
  await seedUtilities(orgId);
  await seedBudgets(orgId, userId);
  await seedMaintenance(orgId, userId);
  await seedDocuments(orgId, userId);
  await seedActivity(orgId, userId);
  await seedNotifications(orgId, userId);
  await seedUatInboundPhoneMapping(orgId);

  const ok = await verify(orgId);

  console.log('\n=== DEMO LOGIN ===');
  console.log(`Email:    ${DEMO_EMAIL}`);
  console.log(`Password: ${DEMO_PASSWORD}`);
  console.log(`Org ID:   ${orgId}`);
  console.log(`User ID:  ${userId}`);
  if (!ok) process.exitCode = 1;
}

main().catch((error) => fail('main', error));
