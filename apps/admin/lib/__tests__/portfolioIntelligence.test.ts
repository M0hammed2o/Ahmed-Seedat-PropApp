import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { reconcilePortfolioInsights } from '../portfolioIntelligence';

// Final pre-UAT engineering pass (WORKLOG.md this date), Part 4: reconcilePortfolioInsights() has
// existed, fully implemented, since an earlier pass but had ZERO test coverage of any kind
// (confirmed by an exhaustive repo-wide grep before this pass) despite being the sole write path
// for portfolio_insights. Real local-Supabase integration test, same pattern as billing.test.ts --
// proves real rule-firing, real idempotency, real auto-resolve, and real cross-org isolation live,
// not by reading the code and trusting it.

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

describeIfSupabase('reconcilePortfolioInsights (real local Supabase integration)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let propertyId: string;
  let unitId: string;
  let leaseId: string;
  let userId: string;

  beforeEach(async () => {
    const stamp = Date.now();
    const { data: org, error: orgError } = await serviceClient
      .from('organizations')
      .insert({
        legal_name: `Portfolio Intelligence Vitest Org ${stamp}`,
        org_type: 'agency',
        status: 'active',
      })
      .select('id')
      .single();
    if (orgError) throw orgError;
    orgId = org.id;

    const { data: property, error: propertyError } = await serviceClient
      .from('properties')
      .insert({
        org_id: orgId,
        nickname: 'PI Vitest Property',
        address_line1: '1 Test St',
        city: 'Durban',
        country: 'ZA',
        property_type: 'apartment',
      })
      .select('id')
      .single();
    if (propertyError) throw propertyError;
    propertyId = property.id;

    const { data: unit, error: unitError } = await serviceClient
      .from('units')
      .insert({ property_id: propertyId, org_id: orgId, unit_label: 'Unit 1', status: 'occupied' })
      .select('id')
      .single();
    if (unitError) throw unitError;
    unitId = unit.id;

    const { data: lease, error: leaseError } = await serviceClient
      .from('leases')
      .insert({
        org_id: orgId,
        unit_id: unitId,
        start_date: '2026-01-01',
        rent_amount: 4000,
        status: 'active',
        source: 'manual',
      })
      .select('id')
      .single();
    if (leaseError) throw leaseError;
    leaseId = lease.id;

    const { data: auth } = await serviceClient.auth.admin.createUser({
      email: `pi-vitest-${Date.now()}@propertyvault.example`,
      password: 'TestPassw0rd!23',
      email_confirm: true,
    });
    userId = auth!.user!.id;
  });

  afterEach(async () => {
    await serviceClient.from('portfolio_insights').delete().eq('org_id', orgId);
    await serviceClient.from('utility_readings').delete().eq('org_id', orgId);
    await serviceClient.from('utility_meters').delete().eq('org_id', orgId);
    await serviceClient.from('property_budgets').delete().eq('org_id', orgId);
    await serviceClient.from('expenses').delete().eq('org_id', orgId);
    await serviceClient.from('rent_schedules').delete().eq('org_id', orgId);
    await serviceClient.from('leases').delete().eq('org_id', orgId);
    await serviceClient.from('units').delete().eq('org_id', orgId);
    await serviceClient.from('properties').delete().eq('org_id', orgId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
    if (userId) await serviceClient.auth.admin.deleteUser(userId);
  });

  it('inserts a real, grounded rent_overdue insight for an actual overdue rent_schedules row', async () => {
    const { data: schedule, error } = await serviceClient
      .from('rent_schedules')
      .insert({
        org_id: orgId,
        lease_id: leaseId,
        due_date: '2026-01-01',
        amount: 4000,
        status: 'overdue',
      })
      .select('id')
      .single();
    if (error) throw error;

    const result = await reconcilePortfolioInsights(serviceClient, orgId);
    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.autoResolved).toBe(0);

    const { data: insights } = await serviceClient
      .from('portfolio_insights')
      .select('insight_type, message, severity, data_source, dismissed_at')
      .eq('org_id', orgId);
    expect(insights).toHaveLength(1);
    expect(insights![0]!.insight_type).toBe('rent_overdue');
    expect(insights![0]!.dismissed_at).toBeNull();
    // The evidence trail points back to the REAL row, not a fabricated one.
    const dataSource = insights![0]!.data_source as { triggering_records: Array<{ id: string }> };
    expect(dataSource.triggering_records[0]!.id).toBe(schedule.id);
  });

  it('is idempotent -- re-running with no data change inserts/updates/resolves nothing', async () => {
    await serviceClient.from('rent_schedules').insert({
      org_id: orgId,
      lease_id: leaseId,
      due_date: '2026-01-01',
      amount: 4000,
      status: 'overdue',
    });

    await reconcilePortfolioInsights(serviceClient, orgId);
    const second = await reconcilePortfolioInsights(serviceClient, orgId);

    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.autoResolved).toBe(0);

    const { count } = await serviceClient
      .from('portfolio_insights')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId);
    expect(count).toBe(1);
  });

  it('auto-resolves a stale insight once the underlying condition is no longer true, without deleting the row', async () => {
    const { data: schedule } = await serviceClient
      .from('rent_schedules')
      .insert({
        org_id: orgId,
        lease_id: leaseId,
        due_date: '2026-01-01',
        amount: 4000,
        status: 'overdue',
      })
      .select('id')
      .single();

    await reconcilePortfolioInsights(serviceClient, orgId);

    // The rent is now paid -- the rent_overdue condition no longer holds.
    await serviceClient.from('rent_schedules').update({ status: 'paid' }).eq('id', schedule!.id);

    const result = await reconcilePortfolioInsights(serviceClient, orgId);
    expect(result.autoResolved).toBe(1);
    expect(result.inserted).toBe(0);

    const { data: insight } = await serviceClient
      .from('portfolio_insights')
      .select('dismissed_at')
      .eq('org_id', orgId)
      .single();
    expect(insight!.dismissed_at).not.toBeNull();
  });

  it('never creates an insight for an org that has no triggering data at all', async () => {
    const result = await reconcilePortfolioInsights(serviceClient, orgId);
    expect(result.inserted).toBe(0);

    const { count } = await serviceClient
      .from('portfolio_insights')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId);
    expect(count).toBe(0);
  });

  it('reconciling Org A never creates or touches an insight for Org B', async () => {
    const { data: otherOrg } = await serviceClient
      .from('organizations')
      .insert({
        legal_name: `PI Vitest Other Org ${Date.now()}`,
        org_type: 'agency',
        status: 'active',
      })
      .select('id')
      .single();

    await serviceClient.from('rent_schedules').insert({
      org_id: orgId,
      lease_id: leaseId,
      due_date: '2026-01-01',
      amount: 4000,
      status: 'overdue',
    });

    await reconcilePortfolioInsights(serviceClient, otherOrg!.id);

    const { count } = await serviceClient
      .from('portfolio_insights')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', otherOrg!.id);
    expect(count).toBe(0);

    await serviceClient.from('organizations').delete().eq('id', otherOrg!.id);
  });

  // V1 utilities/rates/levies/budgets pass (UTILITIES_RATES_BUDGET_GAP_AUDIT.md §14) -- same real
  // local-Supabase integration pattern as the rent_overdue tests above, proving the three new rules
  // actually fire against real rows, not just reading the rule code and trusting it.

  it('raises budget_exceeded once actual expenses pass the planned amount, never budget_approaching at the same time', async () => {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    const monthIso = monthStart.toISOString().slice(0, 10);

    await serviceClient.from('property_budgets').insert({
      org_id: orgId,
      property_id: propertyId,
      month: monthIso,
      planned_amount: 1000,
      created_by: userId,
    });
    await serviceClient.from('expenses').insert({
      org_id: orgId,
      property_id: propertyId,
      category: 'Water',
      amount: 1200,
      invoice_date: monthIso,
    });

    const result = await reconcilePortfolioInsights(serviceClient, orgId);
    expect(result.inserted).toBe(1);

    const { data: insights } = await serviceClient
      .from('portfolio_insights')
      .select('insight_type, severity')
      .eq('org_id', orgId);
    expect(insights).toHaveLength(1);
    expect(insights![0]!.insight_type).toBe('budget_exceeded');
    expect(insights![0]!.severity).toBe('urgent');
  });

  it('raises budget_approaching (warning) at 80-99% used, and auto-resolves it once spend drops back under threshold', async () => {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    const monthIso = monthStart.toISOString().slice(0, 10);

    await serviceClient.from('property_budgets').insert({
      org_id: orgId,
      property_id: propertyId,
      month: monthIso,
      planned_amount: 1000,
      created_by: userId,
    });
    const { data: expense } = await serviceClient
      .from('expenses')
      .insert({ org_id: orgId, property_id: propertyId, category: 'Levies', amount: 850, invoice_date: monthIso })
      .select('id')
      .single();

    const first = await reconcilePortfolioInsights(serviceClient, orgId);
    expect(first.inserted).toBe(1);
    const { data: insightsAfterFirst } = await serviceClient
      .from('portfolio_insights')
      .select('insight_type, severity')
      .eq('org_id', orgId);
    expect(insightsAfterFirst![0]!.insight_type).toBe('budget_approaching');
    expect(insightsAfterFirst![0]!.severity).toBe('warning');

    // Spend drops back under 80% -- the condition no longer holds.
    await serviceClient.from('expenses').update({ amount: 100 }).eq('id', expense!.id);
    const second = await reconcilePortfolioInsights(serviceClient, orgId);
    expect(second.autoResolved).toBe(1);
  });

  it('raises unusual_utility_usage only once BOTH the percentage and absolute floor are crossed, with safe wording', async () => {
    const { data: meter } = await serviceClient
      .from('utility_meters')
      .insert({
        org_id: orgId,
        property_id: propertyId,
        utility_type: 'water',
        responsibility_mode: 'owner_paid',
      })
      .select('id')
      .single();

    // Three readings: the anomaly check compares this PERIOD's consumption against the PREVIOUS
    // period's consumption, so the previous period needs its own real (non-null) consumption --
    // that itself requires a reading before it. July=0 (baseline), August=1000 (consumption 1000),
    // September=2200 (consumption 1200) -- 1200 vs 1000 = +20%, well over the 200 L absolute floor.
    await serviceClient.from('utility_readings').insert([
      {
        org_id: orgId,
        meter_id: meter!.id,
        period_month: '2026-07-01',
        reading_date: '2026-07-31',
        reading_value: 0,
        consumption: null,
        unit_of_measure: 'L',
      },
      {
        org_id: orgId,
        meter_id: meter!.id,
        period_month: '2026-08-01',
        reading_date: '2026-08-31',
        reading_value: 1000,
        consumption: 1000,
        unit_of_measure: 'L',
      },
      {
        org_id: orgId,
        meter_id: meter!.id,
        period_month: '2026-09-01',
        reading_date: '2026-09-30',
        reading_value: 2200,
        consumption: 1200,
        unit_of_measure: 'L',
      },
    ]);

    const result = await reconcilePortfolioInsights(serviceClient, orgId);
    expect(result.inserted).toBe(1);

    const { data: insights } = await serviceClient
      .from('portfolio_insights')
      .select('insight_type, message, severity')
      .eq('org_id', orgId);
    expect(insights).toHaveLength(1);
    expect(insights![0]!.insight_type).toBe('unusual_utility_usage');
    expect(insights![0]!.severity).toBe('warning');
    expect(insights![0]!.message).toContain('Unusual water usage');
    expect(insights![0]!.message.toLowerCase()).not.toContain('leak');
  });

  it('does not raise unusual_utility_usage for a large percentage increase on a tiny, meaningless base', async () => {
    const { data: meter } = await serviceClient
      .from('utility_meters')
      .insert({
        org_id: orgId,
        property_id: propertyId,
        utility_type: 'electricity',
        responsibility_mode: 'owner_paid',
      })
      .select('id')
      .single();

    await serviceClient.from('utility_readings').insert([
      {
        org_id: orgId,
        meter_id: meter!.id,
        period_month: '2026-07-01',
        reading_date: '2026-07-31',
        reading_value: 0,
        consumption: null,
        unit_of_measure: 'kWh',
      },
      {
        org_id: orgId,
        meter_id: meter!.id,
        period_month: '2026-08-01',
        reading_date: '2026-08-31',
        reading_value: 10,
        consumption: 10,
        unit_of_measure: 'kWh',
      },
      {
        org_id: orgId,
        meter_id: meter!.id,
        period_month: '2026-09-01',
        reading_date: '2026-09-30',
        reading_value: 25,
        consumption: 15, // 15 vs 10 = +50% (would trip the percentage threshold alone), but only
        // +5 kWh absolute -- below the 20 kWh floor, so must NOT trigger.
        unit_of_measure: 'kWh',
      },
    ]);

    const result = await reconcilePortfolioInsights(serviceClient, orgId);
    expect(result.inserted).toBe(0);
  });
});
