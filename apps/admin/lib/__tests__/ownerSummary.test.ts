import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  computeOwnerMonthlySummary,
  getOrCreateOwnerMonthlySummary,
  resolveCalendarMonthPeriod,
  formatSummaryMonthLabel,
} from '../ownerSummary';

// WhatsApp V1 final pre-production pass, Phase 4/10 (WORKLOG.md this date). Real integration
// coverage for the owner_monthly_property_summary aggregation: authorized-property scoping
// (owner A never sees owner B's numbers even in the same org), the confirmed/awaiting/outstanding
// split (a payment_reports 'reported' row must never be folded into confirmedPaid or reduce
// outstanding), and idempotent create-once-per-(owner, month) semantics.

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

const PERIOD_START = '2026-03-01';
const PERIOD_END = '2026-03-31';

describeIfSupabase('owner monthly summary aggregation (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  const userIds: string[] = [];
  const propertyIds: string[] = [];
  let ownerAId: string;
  let ownerAUserId: string;
  let ownerBId: string;

  beforeEach(async () => {
    const { data: org } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `OwnerSummary Vitest Org ${Date.now()}`, org_type: 'agency' })
      .select('id')
      .single();
    orgId = org!.id;

    const { data: authA } = await serviceClient.auth.admin.createUser({
      email: `os-owner-a-${Date.now()}@propertyvault.example`,
      password: 'TestPassw0rd!23',
      email_confirm: true,
    });
    ownerAUserId = authA!.user!.id;
    userIds.push(ownerAUserId);

    const { data: authB } = await serviceClient.auth.admin.createUser({
      email: `os-owner-b-${Date.now()}@propertyvault.example`,
      password: 'TestPassw0rd!23',
      email_confirm: true,
    });
    userIds.push(authB!.user!.id);

    const { data: ownerA } = await serviceClient
      .from('owners')
      .insert({
        org_id: orgId,
        name: 'Owner A',
        owner_type: 'individual',
        status: 'active',
        user_id: ownerAUserId,
        phone: '+27821111111',
      })
      .select('id')
      .single();
    ownerAId = ownerA!.id;

    const { data: ownerB } = await serviceClient
      .from('owners')
      .insert({
        org_id: orgId,
        name: 'Owner B',
        owner_type: 'individual',
        status: 'active',
        user_id: authB!.user!.id,
        phone: '+27822222222',
      })
      .select('id')
      .single();
    ownerBId = ownerB!.id;

    // Property A -- owner A only.
    const { data: propertyA } = await serviceClient
      .from('properties')
      .insert({
        org_id: orgId,
        owner_user_id: ownerAUserId,
        nickname: 'Summary Vitest Property A',
        address_line1: '1 Test St',
        city: 'Cape Town',
      })
      .select('id')
      .single();
    propertyIds.push(propertyA!.id);
    await serviceClient
      .from('property_owners')
      .insert({ property_id: propertyA!.id, owner_id: ownerAId, ownership_pct: 100 });

    const { data: unitA } = await serviceClient
      .from('units')
      .insert({ property_id: propertyA!.id, org_id: orgId, unit_label: 'A1' })
      .select('id')
      .single();

    const { data: leaseA } = await serviceClient
      .from('leases')
      .insert({
        org_id: orgId,
        unit_id: unitA!.id,
        start_date: '2025-01-01',
        end_date: '2026-03-20', // within the 60-day upcoming-expiry window of PERIOD_END
        rent_amount: 1500,
        status: 'active',
      })
      .select('id')
      .single();

    // Expected 1500 (1000 paid + 500 pending), confirmed 1000, outstanding 500.
    await serviceClient.from('rent_schedules').insert([
      { org_id: orgId, lease_id: leaseA!.id, due_date: '2026-03-01', amount: 1000, status: 'paid' },
      {
        org_id: orgId,
        lease_id: leaseA!.id,
        due_date: '2026-03-15',
        amount: 500,
        status: 'pending',
      },
    ]);

    // Awaiting-confirmation: 200, must never be folded into confirmedPaid/outstanding above.
    const { data: tenantA } = await serviceClient
      .from('tenants')
      .insert({ org_id: orgId, full_name: 'Summary Vitest Tenant A' })
      .select('id')
      .single();
    const { error: reportError } = await serviceClient.from('payment_reports').insert({
      org_id: orgId,
      property_id: propertyA!.id,
      lease_id: leaseA!.id,
      tenant_id: tenantA!.id,
      reported_by_tenant: true,
      reported_by_user_id: ownerAUserId,
      amount: 200,
      payment_method: 'eft',
      payment_date: '2026-03-10',
      status: 'reported',
    });
    if (reportError)
      throw new Error(`fixture: payment_reports insert failed: ${reportError.message}`);

    // One open, one completed -- only the open one counts.
    await serviceClient.from('maintenance_tickets').insert([
      {
        org_id: orgId,
        property_id: propertyA!.id,
        submitted_by_user_id: ownerAUserId,
        summary: 'Open ticket',
        status: 'to_do',
      },
      {
        org_id: orgId,
        property_id: propertyA!.id,
        submitted_by_user_id: ownerAUserId,
        summary: 'Closed ticket',
        status: 'completed',
        resolved_at: new Date().toISOString(),
      },
    ]);

    // Property B -- owner B only, deliberately different numbers, to prove isolation.
    const { data: propertyB } = await serviceClient
      .from('properties')
      .insert({
        org_id: orgId,
        owner_user_id: authB!.user!.id,
        nickname: 'Summary Vitest Property B',
        address_line1: '2 Test St',
        city: 'Cape Town',
      })
      .select('id')
      .single();
    propertyIds.push(propertyB!.id);
    await serviceClient
      .from('property_owners')
      .insert({ property_id: propertyB!.id, owner_id: ownerBId, ownership_pct: 100 });

    const { data: unitB } = await serviceClient
      .from('units')
      .insert({ property_id: propertyB!.id, org_id: orgId, unit_label: 'B1' })
      .select('id')
      .single();
    const { data: leaseB } = await serviceClient
      .from('leases')
      .insert({
        org_id: orgId,
        unit_id: unitB!.id,
        start_date: '2025-01-01',
        rent_amount: 9999,
        status: 'active',
      })
      .select('id')
      .single();
    await serviceClient
      .from('rent_schedules')
      .insert({
        org_id: orgId,
        lease_id: leaseB!.id,
        due_date: '2026-03-01',
        amount: 9999,
        status: 'paid',
      });
  });

  afterEach(async () => {
    await serviceClient.from('owner_property_summaries').delete().eq('org_id', orgId);
    await serviceClient.from('maintenance_tickets').delete().eq('org_id', orgId);
    await serviceClient.from('payment_reports').delete().eq('org_id', orgId);
    await serviceClient.from('rent_schedules').delete().eq('org_id', orgId);
    await serviceClient.from('leases').delete().eq('org_id', orgId);
    await serviceClient.from('units').delete().eq('org_id', orgId);
    await serviceClient.from('tenants').delete().eq('org_id', orgId);
    await serviceClient.from('property_owners').delete().in('property_id', propertyIds);
    await serviceClient.from('properties').delete().in('id', propertyIds);
    await serviceClient.from('owners').delete().eq('org_id', orgId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    for (const uid of userIds) {
      await serviceClient.auth.admin.deleteUser(uid).catch(() => {});
    }
  });

  it("scopes strictly to the owner's own authorized properties, and separates confirmed/outstanding/awaiting correctly", async () => {
    const summary = await computeOwnerMonthlySummary(serviceClient, {
      ownerId: ownerAId,
      ownerUserId: ownerAUserId,
      orgId,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    expect(summary.propertyCount).toBe(1);
    expect(summary.expectedRent).toBe(1500);
    expect(summary.confirmedPaid).toBe(1000);
    expect(summary.outstanding).toBe(500);
    expect(summary.awaitingConfirmation).toBe(200);
    expect(summary.openMaintenanceCount).toBe(1);
    expect(summary.upcomingLeaseExpiryCount).toBe(1);

    // Never Owner B's R9999 leaking into Owner A's numbers.
    expect(summary.expectedRent).not.toBe(1500 + 9999);
  });

  it('is idempotent: a second create call reuses the same stored snapshot row, never recomputes or duplicates it', async () => {
    const first = await getOrCreateOwnerMonthlySummary(serviceClient, {
      ownerId: ownerAId,
      ownerUserId: ownerAUserId,
      orgId,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    const second = await getOrCreateOwnerMonthlySummary(serviceClient, {
      ownerId: ownerAId,
      ownerUserId: ownerAUserId,
      orgId,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(second.id).toBe(first.id);

    const { count } = await serviceClient
      .from('owner_property_summaries')
      .select('id', { count: 'exact', head: true })
      .eq('owner_user_id', ownerAUserId)
      .eq('period_start', PERIOD_START);
    expect(count).toBe(1);
  });
});

describe('resolveCalendarMonthPeriod / formatSummaryMonthLabel (pure)', () => {
  it('resolves the calendar-month bounds containing a given date', () => {
    expect(resolveCalendarMonthPeriod(new Date(Date.UTC(2026, 1, 15)))).toEqual({
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
    });
  });

  it('formats a period start as a human month label', () => {
    expect(formatSummaryMonthLabel('2026-03-01')).toBe('March 2026');
  });
});
