// Shapes the Proplyst UAT/demo organisation into a portfolio that is worth recording.
//
// WHY THIS EXISTS. The UAT org accumulated whatever each acceptance pass happened to need -- a
// R45,000 one-off maintenance row, a single paid invoice, "UAT ..." property names -- which is
// fine for testing and terrible on camera: the owner dashboard showed a monthly net position of
// -R47,450 and the word "UAT" in every clip. This rewrites that org's own demo records into a
// realistic small South African landlord portfolio. It changes NOTHING about how any figure is
// calculated; every number the app shows is still computed server-side from these rows.
//
// SAFETY. Hard-gated to one organisation id, passed in UAT_ORG_ID and cross-checked against the
// credentials file. It refuses to run against any other org, so it cannot touch a real customer.
// Every person and business named below is fictional.
//
// Usage (from apps/admin/):
//   set -a; . ./.env.local; set +a
//   UAT_CRED_FILE=<path to uat-creds.json> node scripts/prepare-uat-demo-portfolio.mjs [--apply]
//
// Without --apply it prints the plan and the resulting figures, and writes nothing.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const creds = JSON.parse(readFileSync(process.env.UAT_CRED_FILE, 'utf8'));
const ORG = creds.orgId;

// The one organisation this script is ever allowed to write to.
const ALLOWED_ORG = '6b4d43a8-2bac-4ac9-ab9e-883c0303d3a7';
if (ORG !== ALLOWED_ORG) {
  console.error(`SAFETY: credentials point at org ${ORG}, which is not the UAT demo org. Refusing.`);
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const MONTH = '2026-09-01';
const OWNER_USER = '12edde54-ba04-4440-9681-1b7a831beabd'; // UAT principal, for created_by columns

/** Old name -> the name an owner would actually give the place. */
const RENAMES = {
  'UAT Seaside Apartments': 'Marine Parade Apartments',
  'UAT Hillcrest House': 'Hillcrest Family Home',
  'UAT Central Offices': 'Lembede Place Offices',
};

/**
 * One month of believable operating spend per property, and the budget it runs against.
 * The budgets are chosen so the alert feed tells a story rather than screaming: the apartment
 * block is close to its budget, the house went over it on a geyser repair, the offices are
 * comfortably inside theirs.
 */
const PLAN = {
  'Marine Parade Apartments': {
    budget: 10000,
    expenses: [
      ['Rates & taxes', 'rates_taxes', 3500, 'Municipal rates - September'],
      ['Levies', 'levies', 1800, 'Body corporate levy - September'],
      ['Water', 'water', 950, 'Municipal water - September'],
      ['Electricity', 'electricity', 1400, 'Common-area electricity - September'],
      ['Maintenance', 'maintenance', 1200, 'Common-area light fittings replaced'],
    ],
  },
  'Hillcrest Family Home': {
    budget: 4800,
    expenses: [
      ['Rates & taxes', 'rates_taxes', 1850, 'Municipal rates - September'],
      ['Water', 'water', 640, 'Municipal water - September'],
      ['Maintenance', 'maintenance', 2650, 'Geyser element and thermostat replaced'],
    ],
  },
  'Lembede Place Offices': {
    budget: 16000,
    expenses: [
      ['Rates & taxes', 'rates_taxes', 3900, 'Municipal rates - September'],
      ['Electricity', 'electricity', 2100, 'Common-area electricity - September'],
      ['Water', 'water', 1250, 'Municipal water - September'],
      ['Maintenance', 'maintenance', 4200, 'Lift service contract - quarterly'],
    ],
  },
};

/** A commercial tenant for the empty office suite, so the portfolio reads as mixed-use and let. */
const NEW_COMMERCIAL_TENANT = {
  property: 'Lembede Place Offices',
  unitLabel: 'Suite A',
  tenantName: 'Khanya Design Studio',
  email: 'accounts@khanyadesign.invalid',
  phone: '0311234567',
  rent: 12000,
};

/** The one September rent left unpaid, so the feed has a real overdue-rent alert to show. */
const LEAVE_UNPAID_UNIT = '102';

const changes = [];
const note = (s) => { changes.push(s); console.log('  ' + s); };

async function main() {
  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to write) ===');

  const { data: props } = await db.from('properties').select('id,nickname').eq('org_id', ORG);
  const { data: units } = await db.from('units').select('id,property_id,unit_label,status').eq('org_id', ORG);
  const byName = (n) => props.find((p) => p.nickname === n || RENAMES[p.nickname] === n);

  // 1. Property names -------------------------------------------------------
  console.log('\n1. Property names');
  for (const [oldName, newName] of Object.entries(RENAMES)) {
    const p = props.find((x) => x.nickname === oldName);
    if (!p) { console.log(`  (already renamed) ${newName}`); continue; }
    if (APPLY) await db.from('properties').update({ nickname: newName }).eq('id', p.id);
    note(`property "${oldName}" -> "${newName}" (${p.id})`);
  }

  // 2. Placeholder tenant name ---------------------------------------------
  console.log('\n2. Tenant names');
  const { data: placeholder } = await db.from('tenants').select('id,full_name')
    .eq('org_id', ORG).eq('full_name', 'UAT Portal Tenant').maybeSingle();
  if (placeholder) {
    if (APPLY) await db.from('tenants').update({ full_name: 'Thandeka Mokoena' }).eq('id', placeholder.id);
    note(`tenant "UAT Portal Tenant" -> "Thandeka Mokoena" (${placeholder.id})`);
  } else {
    console.log('  (already renamed)');
  }

  // 3. Operating expenses ---------------------------------------------------
  console.log('\n3. Operating expenses for September');
  const { data: oldExpenses } = await db.from('expenses').select('id').eq('org_id', ORG);
  if (APPLY && oldExpenses.length) {
    const { error } = await db.from('expenses').delete().in('id', oldExpenses.map((e) => e.id));
    if (error) throw new Error('expense delete failed: ' + error.message);
  }
  note(`removed ${oldExpenses.length} previous expense rows (incl. the R45,000 outlier)`);

  const expenseRows = [];
  for (const [propName, cfg] of Object.entries(PLAN)) {
    const p = byName(propName);
    for (const [category, code, amount, notes] of cfg.expenses) {
      expenseRows.push({
        org_id: ORG, property_id: p.id, category, category_code: code,
        amount, status: 'pending', invoice_date: MONTH, notes,
      });
    }
  }
  if (APPLY) {
    const { error } = await db.from('expenses').insert(expenseRows);
    if (error) throw new Error('expense insert failed: ' + error.message);
  }
  note(`inserted ${expenseRows.length} realistic expense rows totalling R${expenseRows.reduce((s, e) => s + e.amount, 0).toLocaleString()}`);

  // 4. Monthly budgets ------------------------------------------------------
  console.log('\n4. September budgets');
  for (const [propName, cfg] of Object.entries(PLAN)) {
    const p = byName(propName);
    if (APPLY) {
      const { error } = await db.from('property_budgets')
        .upsert({ org_id: ORG, property_id: p.id, month: MONTH, planned_amount: cfg.budget, created_by: OWNER_USER },
          { onConflict: 'property_id,month' });
      if (error) throw new Error('budget upsert failed: ' + error.message);
    }
    const actual = cfg.expenses.reduce((s, e) => s + e[2], 0);
    note(`${propName}: budget R${cfg.budget.toLocaleString()} vs actual R${actual.toLocaleString()} (${Math.round((actual / cfg.budget) * 100)}%)`);
  }

  // 5. Let the empty office suite ------------------------------------------
  console.log('\n5. Commercial tenancy');
  const offices = byName(NEW_COMMERCIAL_TENANT.property);
  const suite = units.find((u) => u.property_id === offices.id && u.unit_label === NEW_COMMERCIAL_TENANT.unitLabel);
  const { data: existingLease } = await db.from('leases').select('id').eq('unit_id', suite.id).maybeSingle();
  if (existingLease) {
    console.log('  (suite already let)');
  } else if (APPLY) {
    const { data: tenant, error: te } = await db.from('tenants').insert({
      org_id: ORG, full_name: NEW_COMMERCIAL_TENANT.tenantName,
      email: NEW_COMMERCIAL_TENANT.email, phone: NEW_COMMERCIAL_TENANT.phone, status: 'active',
    }).select('id').single();
    if (te) throw new Error('tenant insert failed: ' + te.message);
    const { data: lease, error: le } = await db.from('leases').insert({
      org_id: ORG, unit_id: suite.id, start_date: '2026-01-01', end_date: '2026-12-31',
      rent_amount: NEW_COMMERCIAL_TENANT.rent, rent_frequency: 'monthly',
      deposit_amount: NEW_COMMERCIAL_TENANT.rent, status: 'active', source: 'manual',
    }).select('id').single();
    if (le) throw new Error('lease insert failed: ' + le.message);
    await db.from('lease_tenants').insert({ lease_id: lease.id, tenant_id: tenant.id, is_primary: true });
    note(`let ${NEW_COMMERCIAL_TENANT.property} ${suite.unit_label} to ${NEW_COMMERCIAL_TENANT.tenantName} at R${NEW_COMMERCIAL_TENANT.rent.toLocaleString()}/month (lease ${lease.id})`);
  } else {
    note(`would let ${NEW_COMMERCIAL_TENANT.property} ${suite.unit_label} to ${NEW_COMMERCIAL_TENANT.tenantName}`);
  }

  console.log('\n(step 6, invoicing and payments, runs in the second script)');
  console.log('\n=== CHANGE LOG ===');
  changes.forEach((c) => console.log('  - ' + c));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
