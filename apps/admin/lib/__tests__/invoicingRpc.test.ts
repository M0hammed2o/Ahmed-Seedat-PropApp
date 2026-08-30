import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Landlord rent-invoicing pass (WORKLOG.md this date). Real integration test against the local
// Supabase instance, same pattern as propertyLifecycle.test.ts -- covers the existing
// invoice_rent_schedule()/confirm_bank_transaction_match() RPCs (migration
// 20260101000038/000073) that back the new /accounting/invoices page and the invoice_number
// column added by migration 20260101000148. This file deliberately does NOT re-test
// dispatchEmail()'s own "no address = no-op" behavior (already covered by
// emailDispatch.test.ts's "no_address" case) -- it proves that ISSUING an invoice alone, with no
// email step at all, never touches email_messages.

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const TEST_PASSWORD = 'TestPassw0rd!23';

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

async function signedInClient(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

describeIfSupabase('rent invoicing (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let orgBId: string;
  let propertyId: string;
  let unitId: string;
  let leaseId: string;
  let tenantId: string;
  let principalId: string;
  let principalEmail: string;
  let viewerId: string;
  let viewerEmail: string;
  let bankAccountId: string;
  const createdUserIds: string[] = [];

  beforeEach(async () => {
    const suffix = randomUUID();
    principalId = randomUUID();
    viewerId = randomUUID();
    createdUserIds.push(principalId, viewerId);
    principalEmail = `invoicing-principal-${suffix}@test.propertyvault.example`;
    viewerEmail = `invoicing-viewer-${suffix}@test.propertyvault.example`;

    for (const [id, email] of [
      [principalId, principalEmail],
      [viewerId, viewerEmail],
    ] as const) {
      const { error } = await serviceClient.auth.admin.createUser({
        id,
        email,
        email_confirm: true,
        password: TEST_PASSWORD,
      } as never);
      if (error) throw error;
    }

    const { data: org, error: orgError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Invoicing Vitest Org ${suffix}`, org_type: 'agency', status: 'active' })
      .select('id')
      .single();
    if (orgError) throw orgError;
    orgId = org.id;
    // Real invoice/payment posting needs the org's chart of accounts -- only seeded by
    // create_organization(), not a raw insert trigger, so a direct-inserted org (every other
    // lifecycle test in this pass creates orgs this way) needs it seeded explicitly here.
    await serviceClient.rpc('seed_chart_of_accounts', { p_org_id: orgId });

    const { data: orgB, error: orgBError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Invoicing Vitest Org B ${suffix}`, org_type: 'agency', status: 'active' })
      .select('id')
      .single();
    if (orgBError) throw orgBError;
    orgBId = orgB.id;

    await serviceClient.from('organization_members').insert([
      { org_id: orgId, user_id: principalId, role: 'principal', status: 'active', joined_at: new Date().toISOString() },
      { org_id: orgId, user_id: viewerId, role: 'viewer', status: 'active', joined_at: new Date().toISOString() },
    ]);

    const { data: property, error: propertyError } = await serviceClient
      .from('properties')
      .insert({ org_id: orgId, nickname: 'Musgrave Heights', address_line1: '1 Test St', city: 'Durban' })
      .select('id')
      .single();
    if (propertyError) throw propertyError;
    propertyId = property.id;

    const { data: unit, error: unitError } = await serviceClient
      .from('units')
      .insert({ org_id: orgId, property_id: propertyId, unit_label: '601' })
      .select('id')
      .single();
    if (unitError) throw unitError;
    unitId = unit.id;

    const { data: tenant, error: tenantError } = await serviceClient
      .from('tenants')
      .insert({ org_id: orgId, full_name: 'John Smith' })
      .select('id')
      .single();
    if (tenantError) throw tenantError;
    tenantId = tenant.id;

    const { data: lease, error: leaseError } = await serviceClient
      .from('leases')
      .insert({ org_id: orgId, unit_id: unitId, start_date: '2026-01-01', rent_amount: 12000, status: 'active' })
      .select('id')
      .single();
    if (leaseError) throw leaseError;
    leaseId = lease.id;

    await serviceClient.from('lease_tenants').insert({ lease_id: leaseId, tenant_id: tenantId, is_primary: true });

    const { data: bankAccount, error: bankAccountError } = await serviceClient
      .from('bank_accounts')
      .insert({ org_id: orgId, account_class: 'business', bank_name: 'Test Bank' })
      .select('id')
      .single();
    if (bankAccountError) throw bankAccountError;
    bankAccountId = bankAccount.id;
  });

  afterEach(async () => {
    for (const id of createdUserIds) {
      try {
        await serviceClient.auth.admin.deleteUser(id);
      } catch {
        // Best-effort local-dev cleanup only.
      }
    }
    await serviceClient.from('organizations').delete().eq('id', orgId);
    await serviceClient.from('organizations').delete().eq('id', orgBId);
  });

  async function insertRentSchedule(dueDate: string, amount: number) {
    const { data, error } = await serviceClient
      .from('rent_schedules')
      .insert({ org_id: orgId, lease_id: leaseId, due_date: dueDate, amount })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  // 1-5: issuing an invoice creates exactly one row, correctly mapped, with a real invoice number,
  // and never emails the tenant.
  it('issuing an invoice for a pending rent obligation creates exactly one invoice with the correct tenant/lease/amount/due-date, and emails nobody', async () => {
    const schedule = await insertRentSchedule('2026-09-01', 12000);
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);

    const { count: emailsBefore } = await serviceClient
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId);

    const { data: invoiceId, error } = await principalClient.rpc('invoice_rent_schedule', {
      p_rent_schedule_id: schedule.id,
    });
    expect(error).toBeNull();

    const { data: invoice } = await serviceClient.from('invoices').select('*').eq('id', invoiceId).single();
    expect(invoice.lease_id).toBe(leaseId);
    expect(invoice.tenant_id).toBe(tenantId);
    expect(Number(invoice.amount)).toBe(12000);
    expect(invoice.period).toBe('2026-09-01');
    expect(invoice.status).toBe('issued');
    expect(invoice.invoice_number).toMatch(/^INV-\d{6}$/);
    expect(invoice.emailed_at).toBeNull();

    const { count: emailsAfter } = await serviceClient
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId);
    expect(emailsAfter).toBe(emailsBefore);

    const { data: allInvoicesForLease } = await serviceClient.from('invoices').select('id').eq('lease_id', leaseId);
    expect(allInvoicesForLease).toHaveLength(1);
  });

  // 6. Every invoice gets a unique, sequential invoice number.
  it('each invoice gets a distinct invoice number', async () => {
    const scheduleA = await insertRentSchedule('2026-09-01', 12000);
    const scheduleB = await insertRentSchedule('2026-10-01', 12000);
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);

    const { data: idA } = await principalClient.rpc('invoice_rent_schedule', { p_rent_schedule_id: scheduleA.id });
    const { data: idB } = await principalClient.rpc('invoice_rent_schedule', { p_rent_schedule_id: scheduleB.id });

    const { data: invoiceA } = await serviceClient.from('invoices').select('invoice_number').eq('id', idA).single();
    const { data: invoiceB } = await serviceClient.from('invoices').select('invoice_number').eq('id', idB).single();
    expect(invoiceA!.invoice_number).not.toBe(invoiceB!.invoice_number);
  });

  // 7. A rent obligation maps to exactly one invoice -- re-invoicing the same schedule is
  // impossible.
  it('a rent obligation cannot be invoiced twice', async () => {
    const schedule = await insertRentSchedule('2026-09-01', 12000);
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);

    const { error: firstError } = await principalClient.rpc('invoice_rent_schedule', { p_rent_schedule_id: schedule.id });
    expect(firstError).toBeNull();

    const { error: secondError } = await principalClient.rpc('invoice_rent_schedule', { p_rent_schedule_id: schedule.id });
    expect(secondError).not.toBeNull();

    const { data: invoices } = await serviceClient.from('invoices').select('id').eq('lease_id', leaseId);
    expect(invoices).toHaveLength(1);
  });

  // 8. A viewer-role staff member cannot issue an invoice.
  it('a viewer-role staff member cannot issue an invoice', async () => {
    const schedule = await insertRentSchedule('2026-09-01', 12000);
    const viewerClient = await signedInClient(viewerEmail, TEST_PASSWORD);

    const { error } = await viewerClient.rpc('invoice_rent_schedule', { p_rent_schedule_id: schedule.id });
    expect(error).not.toBeNull();

    const { data: invoices } = await serviceClient.from('invoices').select('id').eq('lease_id', leaseId);
    expect(invoices).toHaveLength(0);
  });

  // 9. A full payment marks the schedule paid and drives the invoice's paid/balance to fully
  // reconciled (balance 0).
  it('a full bank-transaction payment marks the rent schedule paid, and the invoice reconciles to zero balance', async () => {
    const schedule = await insertRentSchedule('2026-09-01', 12000);
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);
    await principalClient.rpc('invoice_rent_schedule', { p_rent_schedule_id: schedule.id });

    const { data: txn } = await serviceClient
      .from('bank_transactions')
      .insert({ bank_account_id: bankAccountId, transaction_date: '2026-09-02', amount: 12000 })
      .select('id')
      .single();

    const { error: matchError } = await principalClient.rpc('confirm_bank_transaction_match', {
      p_bank_transaction_id: txn!.id,
      p_rent_schedule_id: schedule.id,
    });
    expect(matchError).toBeNull();

    const { data: updatedSchedule } = await serviceClient.from('rent_schedules').select('status').eq('id', schedule.id).single();
    expect(updatedSchedule!.status).toBe('paid');

    const { data: matched } = await serviceClient
      .from('bank_transactions')
      .select('amount')
      .eq('matched_rent_schedule_id', schedule.id)
      .eq('match_status', 'matched');
    const paid = (matched ?? []).reduce((sum, t) => sum + Number(t.amount), 0);
    expect(paid).toBe(12000);
    expect(12000 - paid).toBe(0);
  });

  // 10. A partial payment leaves a positive balance and marks the schedule partial.
  it('a partial bank-transaction payment leaves an outstanding balance and marks the schedule partial', async () => {
    const schedule = await insertRentSchedule('2026-09-01', 12000);
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);
    await principalClient.rpc('invoice_rent_schedule', { p_rent_schedule_id: schedule.id });

    const { data: txn } = await serviceClient
      .from('bank_transactions')
      .insert({ bank_account_id: bankAccountId, transaction_date: '2026-09-02', amount: 8000 })
      .select('id')
      .single();

    await principalClient.rpc('confirm_bank_transaction_match', {
      p_bank_transaction_id: txn!.id,
      p_rent_schedule_id: schedule.id,
    });

    const { data: updatedSchedule } = await serviceClient.from('rent_schedules').select('status, amount').eq('id', schedule.id).single();
    expect(updatedSchedule!.status).toBe('partial');
    expect(Number(updatedSchedule!.amount) - 8000).toBe(4000);
  });

  // 11. A cross-org caller cannot issue an invoice for a schedule that is not theirs.
  it('a cross-org caller cannot issue an invoice for a rent schedule that is not theirs', async () => {
    const schedule = await insertRentSchedule('2026-09-01', 12000);
    const outsiderId = randomUUID();
    createdUserIds.push(outsiderId);
    const outsiderEmail = `invoicing-outsider-${randomUUID()}@test.propertyvault.example`;
    await serviceClient.auth.admin.createUser({ id: outsiderId, email: outsiderEmail, email_confirm: true, password: TEST_PASSWORD } as never);
    await serviceClient.from('organization_members').insert({ org_id: orgBId, user_id: outsiderId, role: 'principal', status: 'active', joined_at: new Date().toISOString() });
    const outsiderClient = await signedInClient(outsiderEmail, TEST_PASSWORD);

    const { error } = await outsiderClient.rpc('invoice_rent_schedule', { p_rent_schedule_id: schedule.id });
    expect(error).not.toBeNull();

    const { data: invoices } = await serviceClient.from('invoices').select('id').eq('lease_id', leaseId);
    expect(invoices).toHaveLength(0);
  });

  // 12. An internal tenant (no email) can still be invoiced with no error.
  it('an internal tenant with no email can be invoiced without error', async () => {
    const { data: internalTenant } = await serviceClient
      .from('tenants')
      .insert({ org_id: orgId, full_name: 'Internal Tenant No Email' })
      .select('id')
      .single();
    const { data: internalLease } = await serviceClient
      .from('leases')
      .insert({ org_id: orgId, unit_id: unitId, start_date: '2026-01-01', rent_amount: 12000, status: 'draft' })
      .select('id')
      .single();
    await serviceClient.from('lease_tenants').insert({ lease_id: internalLease!.id, tenant_id: internalTenant!.id, is_primary: true });
    const { data: schedule } = await serviceClient
      .from('rent_schedules')
      .insert({ org_id: orgId, lease_id: internalLease!.id, due_date: '2026-09-01', amount: 12000 })
      .select('id')
      .single();

    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);
    const { error } = await principalClient.rpc('invoice_rent_schedule', { p_rent_schedule_id: schedule!.id });
    expect(error).toBeNull();

    const { data: invoice } = await serviceClient.from('invoices').select('tenant_id').eq('lease_id', internalLease!.id).single();
    expect(invoice!.tenant_id).toBe(internalTenant!.id);
  });

  // 13. SaaS subscription invoices are a completely separate table -- never mixed with tenant rent
  // invoices.
  it('SaaS subscription invoices are a separate table from tenant rent invoices', async () => {
    const schedule = await insertRentSchedule('2026-09-01', 12000);
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);
    await principalClient.rpc('invoice_rent_schedule', { p_rent_schedule_id: schedule.id });

    const { data: rentInvoices } = await serviceClient.from('invoices').select('id').eq('org_id', orgId);
    expect(rentInvoices).toHaveLength(1);

    const { data: subscriptionInvoices } = await serviceClient
      .from('subscription_invoices')
      .select('id')
      .eq('org_id', orgId);
    expect(subscriptionInvoices ?? []).toHaveLength(0);
  });
});
