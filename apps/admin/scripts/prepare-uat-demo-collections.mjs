// Second half of the UAT/demo portfolio preparation (see prepare-uat-demo-portfolio.mjs).
//
// Issues September rent invoices and records the payments against them, so the owner dashboard's
// hero reads like a working month: most rent in, one tenant genuinely late. The unpaid one is left
// as a real past-due rent schedule rather than a fabricated alert row -- the insight engine derives
// the "overdue" card from it on its own.
//
// Also seeds a short, believable in-app activity feed for the demo owner.
//
// SAFETY: same hard org gate as the first script.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const creds = JSON.parse(readFileSync(process.env.UAT_CRED_FILE, 'utf8'));
const ORG = creds.orgId;
const ALLOWED_ORG = '6b4d43a8-2bac-4ac9-ab9e-883c0303d3a7';
if (ORG !== ALLOWED_ORG) {
  console.error(`SAFETY: credentials point at org ${ORG}, which is not the UAT demo org. Refusing.`);
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const MONTH = '2026-09-01';
const OWNER_USER = '12edde54-ba04-4440-9681-1b7a831beabd';
/** The unit whose September rent stays outstanding, so the alert feed has something true to say. */
const UNPAID_UNIT = '102';

const changes = [];
const note = (s) => { changes.push(s); console.log('  ' + s); };

async function main() {
  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to write) ===');

  const { data: props } = await db.from('properties').select('id,nickname').eq('org_id', ORG);
  const { data: units } = await db.from('units').select('id,property_id,unit_label').eq('org_id', ORG);
  const { data: leases } = await db.from('leases').select('id,unit_id,rent_amount,status').eq('org_id', ORG).eq('status', 'active');
  const { data: lt } = await db.from('lease_tenants').select('lease_id,tenant_id');
  const { data: tenants } = await db.from('tenants').select('id,full_name').eq('org_id', ORG);
  const unitOf = (leaseId) => units.find((u) => u.id === leases.find((l) => l.id === leaseId)?.unit_id);
  const tenantOf = (leaseId) => tenants.find((t) => t.id === lt.find((x) => x.lease_id === leaseId)?.tenant_id);

  // 1. Make sure every active lease has a September rent schedule -----------
  console.log('\n1. September rent schedules');
  const { data: schedules } = await db.from('rent_schedules').select('id,lease_id,amount,status')
    .eq('org_id', ORG).eq('due_date', MONTH);
  for (const lease of leases) {
    if (schedules.some((s) => s.lease_id === lease.id)) continue;
    const row = { org_id: ORG, lease_id: lease.id, due_date: MONTH, amount: lease.rent_amount, status: 'pending' };
    if (APPLY) {
      const { data, error } = await db.from('rent_schedules').insert(row).select('id,lease_id,amount,status').single();
      if (error) throw new Error('rent_schedule insert failed: ' + error.message);
      schedules.push(data);
    }
    note(`created September rent schedule for ${unitOf(lease.id)?.unit_label} at R${lease.rent_amount.toLocaleString()}`);
  }

  // 2. Issue invoices and record payments -----------------------------------
  console.log('\n2. Invoices and payments');
  const { data: existingInvoices } = await db.from('invoices').select('id,lease_id,invoice_number,amount').eq('org_id', ORG).eq('period', MONTH);
  const { data: existingPayments } = await db.from('invoice_payments').select('invoice_id,amount').eq('org_id', ORG);
  let nextNumber = 1 + Math.max(0, ...existingInvoices.map((i) => Number(String(i.invoice_number).replace(/\D/g, '')) || 0));

  for (const sched of schedules) {
    const unit = unitOf(sched.lease_id);
    const tenant = tenantOf(sched.lease_id);
    if (!unit || !tenant) continue;
    let invoice = existingInvoices.find((i) => i.lease_id === sched.lease_id);
    if (!invoice) {
      const row = {
        org_id: ORG, lease_id: sched.lease_id, tenant_id: tenant.id, period: MONTH,
        amount: sched.amount, status: 'issued', issued_at: new Date().toISOString(),
        invoice_number: `INV-${String(nextNumber).padStart(6, '0')}`,
        source: 'rent_schedule', description: 'September 2026 Rent',
      };
      nextNumber += 1;
      if (APPLY) {
        const { data, error } = await db.from('invoices').insert(row).select('id,lease_id,invoice_number,amount').single();
        if (error) throw new Error('invoice insert failed: ' + error.message);
        invoice = data;
        existingInvoices.push(data);
      }
      note(`issued ${row.invoice_number} to ${tenant.full_name} for ${unit.unit_label}, R${Number(sched.amount).toLocaleString()}`);
    }

    if (unit.unit_label === UNPAID_UNIT) {
      // Invoiced but not paid, and its schedule moved to the state it is actually in: due
      // 2026-09-01 and still outstanding. Nothing in this codebase ages a pending schedule into
      // 'overdue' on its own yet (TECHNICAL_DEBT_REGISTER TD-20 -- no scheduled job), so the demo
      // data would otherwise sit in a state real elapsed time should already have left.
      if (APPLY && sched.status !== 'overdue') {
        const { error } = await db.from('rent_schedules').update({ status: 'overdue' }).eq('id', sched.id);
        if (error) throw new Error('schedule overdue update failed: ' + error.message);
      }
      note(`${unit.unit_label} (${tenant.full_name}): invoiced and left unpaid on purpose -- R${Number(sched.amount).toLocaleString()} outstanding, schedule marked overdue`);
      continue;
    }

    const alreadyPaid = invoice && existingPayments.some((p) => p.invoice_id === invoice.id);
    if (!alreadyPaid) {
      if (APPLY) {
        const { error } = await db.from('invoice_payments').insert({
          org_id: ORG, invoice_id: invoice.id, tenant_id: tenant.id, amount: sched.amount,
          paid_at: '2026-09-03', method: 'eft', recorded_by: OWNER_USER,
        });
        if (error) throw new Error('payment insert failed: ' + error.message);
        await db.from('rent_schedules').update({ status: 'paid' }).eq('id', sched.id);
      }
      note(`recorded R${Number(sched.amount).toLocaleString()} EFT from ${tenant.full_name} and marked the schedule paid`);
    }
  }

  // 3. A short, believable activity feed -------------------------------------
  console.log('\n3. Activity feed');
  const { data: existingNotifications } = await db.from('notifications').select('id').eq('user_id', OWNER_USER);
  if (existingNotifications.length) {
    console.log(`  (${existingNotifications.length} already present, leaving them)`);
  } else {
    const feed = [
      ['payment_received', 'Payment received', 'Khanya Design Studio paid R12,000 for Suite A.'],
      ['payment_received', 'Payment received', 'Thandeka Mokoena paid R9,000 for unit 201.'],
      ['payment_received', 'Payment received', 'Naledi Khumalo paid R8,500 for unit 101.'],
      ['expense_recorded', 'Expense recorded', 'Geyser element and thermostat replaced at Hillcrest Family Home - R2,650.'],
      ['rent_overdue', 'Rent overdue', 'September rent for unit 102 is still outstanding.'],
    ].map(([type, title, body]) => ({ user_id: OWNER_USER, type, title, body }));
    if (APPLY) {
      const { error } = await db.from('notifications').insert(feed);
      if (error) throw new Error('notification insert failed: ' + error.message);
    }
    note(`seeded ${feed.length} activity entries for the demo owner`);
  }

  console.log('\n=== CHANGE LOG ===');
  changes.forEach((c) => console.log('  - ' + c));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
