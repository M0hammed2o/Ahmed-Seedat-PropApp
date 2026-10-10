import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// A Pretoria house with a rented flatlet on a hybrid supply (figures illustrative), against real local Supabase:
//   Electricity: municipal grid + 900 kWh solar + battery (300 in / 270 out) + 50 kWh generator; main
//                consumption meter 1 300 kWh; the flatlet's own submeter 150 kWh (metered recharge, R3/kWh).
//   Water:       municipal 20 kL + borehole 15 kL (+120 kWh pump) + a 2 kL tanker delivery, a 5 000 L tank that
//                rose from 40 % to 60 % (+1 kL stored); main consumption meter 33 kL.
// Covers the any-range dashboard (balance, recovery), statements (review before distribution, flag-gated sending,
// tenant RLS, PDF), hybrid alerts (tank low, dedupe, charges awaiting approval) and the portfolio summary.

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
// Never a real provider in tests: dispatchEmail falls back to the mock provider.
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM_ADDRESS;
delete process.env.SMART_UTILITY_TENANT_STATEMENTS_ENABLED;

const { loadHybridDashboard } = await import('../hybridDashboard');
const billing = await import('../billing');
const statements = await import('../statements');
const { runHybridAlerts } = await import('../hybridAlerts');
const { loadUtilityPortfolio } = await import('../portfolio');
const { sastInstant } = await import('../consumption');

const SUPABASE_URL = 'http://127.0.0.1:54321';
let reachable = false;
try {
  reachable = (await fetch(`${SUPABASE_URL}/auth/v1/health`)).ok;
} catch {
  reachable = false;
}
const describeIfSupabase = reachable ? describe : describe.skip;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service: SupabaseClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts);

describeIfSupabase('hybrid utilities (real local Supabase integration)', () => {
  const suffix = Date.now();
  let orgId: string;
  let propertyId: string;
  let staffId: string;
  let staff: SupabaseClient;
  let tenantClient: SupabaseClient;
  let unitId: string;
  let tankId: string;
  const src: Record<string, string> = {};

  async function signIn(email: string) {
    const c = createClient(SUPABASE_URL, ANON_KEY, opts);
    const { error } = await c.auth.signInWithPassword({ email, password: 'TestPassw0rd!23' });
    expect(error).toBeNull();
    return c;
  }

  beforeAll(async () => {
    const staffEmail = `hyd-staff-${suffix}@propertyvault.example`;
    const tenantEmail = `hyd-tenant-${suffix}@propertyvault.example`;
    staffId = (await service.auth.admin.createUser({ email: staffEmail, password: 'TestPassw0rd!23', email_confirm: true })).data.user!.id;
    const tenantUserId = (await service.auth.admin.createUser({ email: tenantEmail, password: 'TestPassw0rd!23', email_confirm: true })).data.user!.id;
    orgId = (await service.from('organizations').insert({ legal_name: `HYD ${suffix}`, org_type: 'agency' }).select('id').single()).data!.id;
    await service.from('organization_members').insert({ org_id: orgId, user_id: staffId, role: 'accountant', status: 'active', joined_at: new Date().toISOString(), property_access_mode: 'all' });
    propertyId = (
      await service.from('properties').insert({ org_id: orgId, nickname: 'Hybrid House', address_line1: '12 Jacaranda St', city: 'Pretoria', province: 'Gauteng', postal_code: '0181' }).select('id').single()
    ).data!.id;
    unitId = (await service.from('units').insert({ org_id: orgId, property_id: propertyId, unit_label: 'Flatlet', size_sqm: 35 }).select('id').single()).data!.id;
    const tenantId = (await service.from('tenants').insert({ org_id: orgId, full_name: 'Thandi Flatlet', status: 'active', user_id: tenantUserId, email: tenantEmail }).select('id').single()).data!.id;
    const leaseId = (await service.from('leases').insert({ org_id: orgId, unit_id: unitId, start_date: '2026-01-01', rent_amount: 5500, status: 'active' }).select('id').single()).data!.id;
    await service.from('lease_tenants').insert({ lease_id: leaseId, tenant_id: tenantId, is_primary: true });

    const addSource = async (key: string, utility: string, type: string, extra: Record<string, unknown> = {}) => {
      src[key] = (await service.from('utility_supply_sources').insert({ org_id: orgId, property_id: propertyId, utility_type: utility, source_type: type, name: key, ...extra }).select('id').single()).data!.id;
    };
    await addSource('Grid', 'electricity', 'municipal_grid');
    await addSource('Roof PV', 'electricity', 'solar_pv');
    await addSource('Battery', 'electricity', 'battery');
    await addSource('Genset', 'electricity', 'generator', { fuel_type: 'diesel', expected_daily_run_hours: 2 });
    await addSource('Municipal water', 'water', 'municipal');
    await addSource('Borehole', 'water', 'borehole');
    await addSource('JoJo', 'water', 'storage_tank', { capacity_value: 5000, capacity_unit: 'litres', low_level_pct: 20 });
    tankId = src.JoJo!;

    const meter = async (utility: string, kind: string, role: string, sourceKey: string | null, from: number, to: number, unit: string | null = null) => {
      const id = (
        await service
          .from('utility_meters')
          .insert({ org_id: orgId, property_id: propertyId, unit_id: unit, utility_type: utility, responsibility_mode: 'owner_paid', meter_role: role, measurement_kind: kind, supply_source_id: sourceKey ? src[sourceKey] : null })
          .select('id')
          .single()
      ).data!.id;
      const r = (y: number, m: number, d: number, v: number) => ({ org_id: orgId, property_id: propertyId, meter_id: id, read_at: sastInstant(y, m, d).toISOString(), raw_value: v, multiplier: 1, value: v, source: 'device' });
      await service.from('meter_telemetry_readings').insert([r(2026, 9, 1, from), r(2026, 9, 16, (from + to) / 2), r(2026, 10, 1, to)]);
    };
    await meter('electricity', 'grid_import', 'main', 'Grid', 10_000, 10_400);
    await meter('electricity', 'generation', 'check', 'Roof PV', 0, 900);
    await meter('electricity', 'battery_charge', 'check', 'Battery', 0, 300);
    await meter('electricity', 'battery_discharge', 'check', 'Battery', 0, 270);
    await meter('electricity', 'generator_output', 'check', 'Genset', 0, 50);
    await meter('electricity', 'consumption', 'main', null, 0, 1300);
    await meter('electricity', 'consumption', 'submeter', null, 0, 150, unitId);
    await meter('electricity', 'pump_energy', 'check', 'Borehole', 0, 120);
    await meter('water', 'source_supply', 'check', 'Municipal water', 0, 20_000);
    await meter('water', 'source_supply', 'check', 'Borehole', 0, 15_000);
    await meter('water', 'consumption', 'main', null, 0, 33_000);

    await service.from('utility_source_readings').insert([
      { org_id: orgId, property_id: propertyId, source_id: tankId, metric: 'tank_level_pct', read_at: sastInstant(2026, 9, 1).toISOString(), value: 40, source: 'manual' },
      { org_id: orgId, property_id: propertyId, source_id: tankId, metric: 'tank_level_pct', read_at: sastInstant(2026, 10, 1).toISOString(), value: 60, source: 'manual' },
    ]);
    await service.from('utility_source_logs').insert([
      { org_id: orgId, property_id: propertyId, source_id: tankId, log_type: 'tanker_delivery', occurred_at: sastInstant(2026, 9, 10, 9).toISOString(), quantity: 2, quantity_unit: 'kL', cost_amount: 900 },
      { org_id: orgId, property_id: propertyId, source_id: src.Genset, log_type: 'fuel_purchase', occurred_at: sastInstant(2026, 9, 12, 9).toISOString(), quantity: 25, quantity_unit: 'litres', cost_amount: 500 },
    ]);
    await service.from('utility_tariffs').insert({ org_id: orgId, property_id: propertyId, utility_type: 'electricity', name: 'Flat R3 (illustrative)', tariff_kind: 'flat', fixed_charge: 0, blocks: [{ upTo: null, rate: 3 }], effective_from: '2026-01-01' });
    await service.from('utility_billing_arrangements').insert({ org_id: orgId, property_id: propertyId, unit_id: unitId, utility_type: 'electricity', arrangement: 'metered_recharge', effective_from: '2026-01-01' });

    staff = await signIn(staffEmail);
    tenantClient = await signIn(tenantEmail);
  }, 90_000);

  it('balances a hybrid site for any date range without double counting', async () => {
    const d = await loadHybridDashboard(staff, propertyId, { from: '2026-09-01', to: '2026-10-01' });
    // 400 grid + 900 solar + 50 generator + 270 discharge − 300 charge = 1 320 kWh entered the site
    expect(d.electricity.siteSupply).toEqual({ value: 1320, basis: 'derived' });
    expect(d.electricity.solarSelfConsumption.value).toBe(600);
    expect(d.electricity.measuredConsumption.value).toBe(1300); // main meter only, the flatlet submeter is inside it
    expect(d.electricity.variance.value).toBe(20);
    expect(d.electricity.pumpEnergy.value).toBe(120);
    expect(d.electricity.gaps).toEqual([]);
    // 20 municipal + 15 borehole + 2 tanker = 37 kL; tank +1 kL stored → 36 kL used on site vs 33 kL metered
    expect(d.water.totalSupply.value).toBe(37);
    expect(d.water.storageChange.value).toBe(1);
    expect(d.water.siteUse.value).toBe(36);
    expect(d.water.variance.value).toBe(3);
    expect(d.series.find((s) => s.utilityType === 'electricity')!.kinds.map((k) => k.kind)).toEqual(expect.arrayContaining(['grid_import', 'generation', 'consumption']));
    expect(d.units[0]).toMatchObject({ unitLabel: 'Flatlet', electricity: { consumption: 150 } });
  }, 60_000);

  it('reports recovery against an estimated supply cost (tariff on grid import + logged fuel)', async () => {
    await billing.generateCharges(service, { propertyId, periodStart: '2026-09-01', periodEnd: '2026-10-01', actorUserId: staffId });
    const { data: charges } = await service.from('utility_charges').select('id, total_amount').eq('property_id', propertyId);
    expect(charges!.map((c) => Number(c.total_amount))).toEqual([450]); // 150 kWh × R3
    await billing.approveCharges(service, { chargeIds: charges!.map((c) => c.id), propertyId, actorUserId: staffId });
    const d = await loadHybridDashboard(staff, propertyId, { from: '2026-09-01', to: '2026-10-01' });
    const e = d.recovery.find((r) => r.utilityType === 'electricity')!;
    expect(e).toMatchObject({ gridOrMunicipalCost: 1200, gridCostBasis: 'estimated', loggedSupplyCost: 500, estimatedSupplyCost: 1700 });
    expect(e.recoveryPct).toBe(26.5); // 450 / 1 700
    const w = d.recovery.find((r) => r.utilityType === 'water')!;
    expect(w).toMatchObject({ gridOrMunicipalCost: null, loggedSupplyCost: 900, recoveryPct: 0 });
  }, 60_000);

  it('statements: draft → approve → tenant can see it; sending stays off until the flag is set', async () => {
    const gen = await statements.generateStatements(service, { propertyId, periodStart: '2026-09-01', periodEnd: '2026-10-01', audience: 'tenant', actorUserId: staffId });
    expect(gen.created).toBe(1);
    expect((await statements.generateStatements(service, { propertyId, periodStart: '2026-09-01', periodEnd: '2026-10-01', audience: 'tenant', actorUserId: staffId })).existing).toBe(1);
    const owner = await statements.generateStatements(service, { propertyId, periodStart: '2026-09-01', periodEnd: '2026-10-01', audience: 'owner', actorUserId: staffId });
    expect(owner.created).toBe(1);
    const statementId = gen.statementIds[0]!;

    // Draft: invisible to the tenant.
    expect((await tenantClient.from('utility_statements').select('id').eq('id', statementId)).data).toEqual([]);
    await expect(statements.statementAction(service, { statementId, propertyId, action: 'send', actorUserId: staffId })).rejects.toThrow(/Approve/);
    await statements.statementAction(service, { statementId, propertyId, action: 'approve', actorUserId: staffId });
    const { data: seen } = await tenantClient.from('utility_statements').select('id, snapshot').eq('id', statementId);
    expect(seen).toHaveLength(1);
    expect(seen![0]!.snapshot.totals.total).toBe(450);
    expect(seen![0]!.snapshot.lines[0]).toMatchObject({ consumption: 150, unit: 'kWh', basis: 'actual' });
    // The owner report is never visible to tenants.
    expect((await tenantClient.from('utility_statements').select('id').eq('audience', 'owner')).data).toEqual([]);
    // Approved snapshots are immutable.
    expect((await service.from('utility_statements').update({ snapshot: {} }).eq('id', statementId)).error).not.toBeNull();

    await expect(statements.statementAction(service, { statementId, propertyId, action: 'send', actorUserId: staffId })).rejects.toThrow(/switched off/);
    process.env.SMART_UTILITY_TENANT_STATEMENTS_ENABLED = 'true';
    try {
      const sent = await statements.statementAction(service, { statementId, propertyId, action: 'send', actorUserId: staffId });
      expect(sent).toEqual({ status: 'sent', deliveryConfigured: false }); // mock provider: nothing left the machine
    } finally {
      delete process.env.SMART_UTILITY_TENANT_STATEMENTS_ENABLED;
    }

    const pdf = await statements.renderStatementPdf(seen![0]!.snapshot);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const { data: ownerRow } = await service.from('utility_statements').select('snapshot').eq('id', owner.statementIds[0]!).single();
    expect((await statements.renderStatementPdf(ownerRow!.snapshot, { draft: true })).subarray(0, 4).toString()).toBe('%PDF');
  }, 60_000);

  it('hybrid alerts: tank low once per day, stale draft charges once per week', async () => {
    await service.from('utility_source_readings').insert({ org_id: orgId, property_id: propertyId, source_id: tankId, metric: 'tank_level_pct', read_at: new Date(Date.now() - 3_600_000).toISOString(), value: 8, source: 'manual' });
    await service.from('utility_charges').insert({
      org_id: orgId, property_id: propertyId, unit_id: unitId, utility_type: 'electricity', charge_type: 'fixed', period_start: '2026-08-01', period_end: '2026-09-01',
      consumption_quality: 'complete', total_amount: 100, status: 'draft', created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });
    const inserted: { rule: string; property_id: string }[] = [];
    const capture = async (alerts: { rule: string; property_id: string; dedupe_key: string }[]) => {
      let n = 0;
      for (const a of alerts) {
        const { data } = await service.from('utility_alerts').upsert(a, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id');
        if (data?.length) {
          n += 1;
          inserted.push(a);
        }
      }
      return n;
    };
    await runHybridAlerts(service, new Date(), capture);
    const mine = inserted.filter((a) => a.property_id === propertyId).map((a) => a.rule).sort();
    expect(mine).toEqual(['charges_awaiting_approval', 'tank_low']);
    inserted.length = 0;
    await runHybridAlerts(service, new Date(), capture);
    expect(inserted.filter((a) => a.property_id === propertyId)).toEqual([]);
    const { data: tankAlert } = await service.from('utility_alerts').select('severity, supply_source_id').eq('property_id', propertyId).eq('rule', 'tank_low').single();
    expect(tankAlert).toEqual({ severity: 'critical', supply_source_id: tankId });
  }, 120_000);

  it('portfolio: summarises the property for staff and shows nothing to the tenant', async () => {
    const p = await loadUtilityPortfolio(staff);
    const row = p.properties.find((r) => r.propertyId === propertyId)!;
    expect(row.alerts.open).toBeGreaterThanOrEqual(2);
    expect(row.alerts.critical).toBeGreaterThanOrEqual(1);
    expect(row.charges.draftCount).toBe(1);
    expect(row.sources).toEqual(expect.arrayContaining(['solar_pv', 'borehole', 'storage_tank']));
    const t = await loadUtilityPortfolio(tenantClient);
    expect(t.properties.find((r) => r.propertyId === propertyId)).toBeUndefined();
  }, 60_000);
});
