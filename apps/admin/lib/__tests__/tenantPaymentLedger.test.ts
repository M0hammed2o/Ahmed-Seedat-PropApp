import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadTenantPaymentLedger } from '../invoicing';

// Tenant-portal release-gate pass (WORKLOG.md this date), Part A gap 2: dedicated automated
// coverage for loadTenantPaymentLedger() -- the staff-facing tenant detail page's Payments tab
// (apps/admin/app/(dashboard)/tenants/[id]/page.tsx). Previously verified only by source
// inspection; this proves it against a real local Supabase instance with real RLS, same pattern as
// invoicingRpc.test.ts. Never touches production -- hardcoded to 127.0.0.1:54321 only.

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const TEST_PASSWORD = 'TestPassw0rd!23';

// loadTenantPaymentLedger() calls getServiceRoleClient() internally (for the "recorded
// by"/"reversed by" display-name lookup) -- that reads process.env directly, not the local
// consts above, so it needs these set the same way every other real-Supabase test in this repo
// sets them.
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;

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

describeIfSupabase('loadTenantPaymentLedger (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let orgBId: string;
  let propertyId: string;
  let unitId: string;
  let tenantId: string;
  let leaseId: string;
  let principalId: string;
  let principalEmail: string;
  const createdUserIds: string[] = [];

  beforeEach(async () => {
    const suffix = randomUUID();
    principalId = randomUUID();
    createdUserIds.push(principalId);
    principalEmail = `tenant-payment-ledger-${suffix}@test.propertyvault.example`;

    const { error: userError } = await serviceClient.auth.admin.createUser({
      id: principalId,
      email: principalEmail,
      email_confirm: true,
      password: TEST_PASSWORD,
    } as never);
    if (userError) throw userError;

    const { data: org, error: orgError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Tenant Ledger Vitest Org ${suffix}`, org_type: 'agency', status: 'active' })
      .select('id')
      .single();
    if (orgError) throw orgError;
    orgId = org.id;
    await serviceClient.rpc('seed_chart_of_accounts', { p_org_id: orgId });

    const { data: orgB, error: orgBError } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Tenant Ledger Vitest Org B ${suffix}`, org_type: 'agency', status: 'active' })
      .select('id')
      .single();
    if (orgBError) throw orgBError;
    orgBId = orgB.id;
    await serviceClient.rpc('seed_chart_of_accounts', { p_org_id: orgBId });

    await serviceClient.from('organization_members').insert([
      { org_id: orgId, user_id: principalId, role: 'principal', status: 'active', joined_at: new Date().toISOString() },
    ]);

    const { data: property, error: propertyError } = await serviceClient
      .from('properties')
      .insert({ org_id: orgId, nickname: 'Ledger Test Property', address_line1: '1 Test St', city: 'Cape Town' })
      .select('id')
      .single();
    if (propertyError) throw propertyError;
    propertyId = property.id;

    const { data: unit, error: unitError } = await serviceClient
      .from('units')
      .insert({ org_id: orgId, property_id: propertyId, unit_label: 'U1' })
      .select('id')
      .single();
    if (unitError) throw unitError;
    unitId = unit.id;

    const { data: tenant, error: tenantError } = await serviceClient
      .from('tenants')
      .insert({ org_id: orgId, full_name: 'Ledger Test Tenant' })
      .select('id')
      .single();
    if (tenantError) throw tenantError;
    tenantId = tenant.id;

    const { data: lease, error: leaseError } = await serviceClient
      .from('leases')
      .insert({ org_id: orgId, unit_id: unitId, start_date: '2026-01-01', rent_amount: 8000, status: 'active' })
      .select('id')
      .single();
    if (leaseError) throw leaseError;
    leaseId = lease.id;
    await serviceClient.from('lease_tenants').insert({ lease_id: leaseId, tenant_id: tenantId, is_primary: true });
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

  it('shows a manual invoice payment, a rent invoice payment, and a partial payment, each correctly described', async () => {
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);

    // Manual invoice, paid in full.
    const { data: manualInvoiceId } = await principalClient.rpc('create_manual_invoice', {
      p_org_id: orgId,
      p_lease_id: leaseId,
      p_tenant_id: tenantId,
      p_invoice_date: '2026-08-01',
      p_due_date: '2026-08-08',
      p_reference: 'REF-MANUAL',
      p_description: 'Parking fee',
      p_notes: null,
      p_line_items: [{ description: 'Parking', quantity: 1, unitPrice: 500 }],
    });
    await principalClient.rpc('issue_manual_invoice', { p_invoice_id: manualInvoiceId });
    await principalClient.rpc('record_invoice_payment', {
      p_invoice_id: manualInvoiceId,
      p_amount: 500,
      p_paid_at: '2026-08-02',
      p_method: 'cash',
      p_reference: 'MANUAL-PAY-1',
      p_notes: null,
    });

    // Rent invoice, PARTIAL payment only.
    const { data: schedule } = await serviceClient
      .from('rent_schedules')
      .insert({ org_id: orgId, lease_id: leaseId, due_date: '2026-09-01', amount: 8000 })
      .select('id')
      .single();
    const { data: rentInvoiceId } = await principalClient.rpc('invoice_rent_schedule', {
      p_rent_schedule_id: schedule!.id,
    });
    await principalClient.rpc('record_invoice_payment', {
      p_invoice_id: rentInvoiceId,
      p_amount: 3000,
      p_paid_at: '2026-09-02',
      p_method: 'eft',
      p_reference: 'RENT-PAY-1',
      p_notes: null,
    });

    const ledger = await loadTenantPaymentLedger(principalClient, tenantId);
    expect(ledger).toHaveLength(2);

    const manualRow = ledger.find((r) => r.reference === 'MANUAL-PAY-1');
    expect(manualRow).toBeTruthy();
    expect(manualRow!.amount).toBe(500);
    expect(manualRow!.description).toBe('Parking fee');
    expect(manualRow!.method).toBe('cash');
    expect(manualRow!.reversedAt).toBeNull();

    const rentRow = ledger.find((r) => r.reference === 'RENT-PAY-1');
    expect(rentRow).toBeTruthy();
    expect(rentRow!.amount).toBe(3000);
    expect(rentRow!.description).toContain('Rent');
    expect(rentRow!.method).toBe('eft');
  });

  it('shows multiple payments against the same invoice as separate rows', async () => {
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);
    const { data: invoiceId } = await principalClient.rpc('create_manual_invoice', {
      p_org_id: orgId,
      p_lease_id: leaseId,
      p_tenant_id: tenantId,
      p_invoice_date: '2026-08-01',
      p_due_date: '2026-08-08',
      p_reference: 'REF-MULTI',
      p_description: 'Multi-payment invoice',
      p_notes: null,
      p_line_items: [{ description: 'Repairs', quantity: 1, unitPrice: 1000 }],
    });
    await principalClient.rpc('issue_manual_invoice', { p_invoice_id: invoiceId });
    await principalClient.rpc('record_invoice_payment', {
      p_invoice_id: invoiceId,
      p_amount: 600,
      p_paid_at: '2026-08-02',
      p_method: 'eft',
      p_reference: 'MULTI-1',
      p_notes: null,
    });
    await principalClient.rpc('record_invoice_payment', {
      p_invoice_id: invoiceId,
      p_amount: 400,
      p_paid_at: '2026-08-03',
      p_method: 'eft',
      p_reference: 'MULTI-2',
      p_notes: null,
    });

    const ledger = await loadTenantPaymentLedger(principalClient, tenantId);
    expect(ledger).toHaveLength(2);
    expect(ledger.map((r) => r.amount).sort()).toEqual([400, 600]);
    expect(new Set(ledger.map((r) => r.id)).size).toBe(2);
  });

  it('marks a reversed payment as reversed without hiding it or deleting it from the ledger', async () => {
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);
    const { data: invoiceId } = await principalClient.rpc('create_manual_invoice', {
      p_org_id: orgId,
      p_lease_id: leaseId,
      p_tenant_id: tenantId,
      p_invoice_date: '2026-08-01',
      p_due_date: '2026-08-08',
      p_reference: 'REF-REV',
      p_description: 'To be reversed',
      p_notes: null,
      p_line_items: [{ description: 'Deposit top-up', quantity: 1, unitPrice: 750 }],
    });
    await principalClient.rpc('issue_manual_invoice', { p_invoice_id: invoiceId });
    const { data: paymentId } = await principalClient.rpc('record_invoice_payment', {
      p_invoice_id: invoiceId,
      p_amount: 750,
      p_paid_at: '2026-08-02',
      p_method: 'eft',
      p_reference: 'REV-1',
      p_notes: null,
    });

    let ledger = await loadTenantPaymentLedger(principalClient, tenantId);
    expect(ledger[0]!.reversedAt).toBeNull();

    const { error: reverseError } = await principalClient.rpc('reverse_invoice_payment', {
      p_payment_id: paymentId,
      p_reason: 'Tenant disputed the charge',
    });
    expect(reverseError).toBeNull();

    ledger = await loadTenantPaymentLedger(principalClient, tenantId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.reversedAt).not.toBeNull();
    expect(ledger[0]!.reversalReason).toBe('Tenant disputed the charge');
    expect(ledger[0]!.amount).toBe(750);
  });

  it("never returns another organisation's payment", async () => {
    const principalClient = await signedInClient(principalEmail, TEST_PASSWORD);

    // A second org, with its own property/unit/tenant/lease/invoice/payment -- same shape, but
    // this test's principal has NO membership in org B at all.
    const { data: propertyB } = await serviceClient
      .from('properties')
      .insert({ org_id: orgBId, nickname: 'Org B Property', address_line1: '2 Other St', city: 'Durban' })
      .select('id')
      .single();
    const { data: unitB } = await serviceClient
      .from('units')
      .insert({ org_id: orgBId, property_id: propertyB!.id, unit_label: 'B1' })
      .select('id')
      .single();
    const { data: tenantB } = await serviceClient
      .from('tenants')
      .insert({ org_id: orgBId, full_name: 'Org B Tenant' })
      .select('id')
      .single();
    const { data: leaseB } = await serviceClient
      .from('leases')
      .insert({ org_id: orgBId, unit_id: unitB!.id, start_date: '2026-01-01', rent_amount: 5000, status: 'active' })
      .select('id')
      .single();
    await serviceClient.from('lease_tenants').insert({ lease_id: leaseB!.id, tenant_id: tenantB!.id, is_primary: true });

    // Service-role fixture setup for org B's own invoice+payment (bypassing RLS purely to seed the
    // OTHER org's data -- the actual isolation proof below queries as the org-A principal).
    const { data: invoiceB } = await serviceClient
      .from('invoices')
      .insert({
        org_id: orgBId,
        lease_id: leaseB!.id,
        tenant_id: tenantB!.id,
        period: '2026-08-01',
        amount: 5000,
        status: 'issued',
        issued_at: new Date().toISOString(),
        source: 'manual',
        description: 'Org B invoice',
        invoice_number: `INV-ORGB-${randomUUID().slice(0, 8)}`,
      })
      .select('id')
      .single();
    await serviceClient.from('invoice_payments').insert({
      org_id: orgBId,
      tenant_id: tenantB!.id,
      invoice_id: invoiceB!.id,
      amount: 5000,
      paid_at: '2026-08-02',
      method: 'eft',
      reference: 'ORGB-PAY-1',
    });

    // The org-A principal has no membership in org B -- RLS must hide org B's payment even if
    // (hypothetically) the caller guessed org B's tenant id.
    const ledgerForOrgBTenant = await loadTenantPaymentLedger(principalClient, tenantB!.id);
    expect(ledgerForOrgBTenant).toHaveLength(0);

    // And org A's own tenant ledger contains none of org B's rows either.
    const ledgerForOrgATenant = await loadTenantPaymentLedger(principalClient, tenantId);
    expect(ledgerForOrgATenant.every((r) => r.reference !== 'ORGB-PAY-1')).toBe(true);
  });
});
