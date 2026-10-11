import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// PILOT SCENARIO (docs/UTILITIES_PILOT_TEST_SCENARIOS.md), real local Supabase. ALL TARIFFS ARE FICTIONAL TEST
// FIGURES — not municipal or legally authorised rates. Every expected rand amount is computed by hand below.
//
// P "Protea Gardens" (hybrid, 7 flats, October 2026 = 31 days):
//   Electricity: municipal grid main meter, solar PV, battery, generator, a main consumption meter, flat submeters.
//   Water: municipal connection, borehole (+ pump energy), JoJo tank (levels) with a tanker delivery, flat meters.
//   Electricity tariff: flat R3,00/kWh incl. VAT + R60,00 fixed/month. Water: 0–6 kL R20, 6–15 R30, >15 R50.
//   F1 metered electricity 200 kWh → 600 + 60 = R660,00; metered water 8 kL → 6×20 + 2×30 = R180,00.
//   F2 electricity included in rent, water paid by the landlord → nothing (meters exist, monitoring only).
//   F3 fixed R400 including 100 kWh, used 130 → R400,00 + 30 × 3 = R90,00 excess (no second fixed charge).
//   F4 fixed R350/month, no allowance → R350,00. F4 + F7 share a 20 kL water meter equally:
//      20 kL = 6×20 + 9×30 + 5×50 = R640,00 → R320,00 each.
//   F5 move-out 15 Oct / move-in 16 Oct: 50 kWh then 40 kWh → 150 + 60×15/31 = R179,03 and 120 + 60×16/31 = R150,97.
//   F6 no closing reading: estimated from September (300 kWh / 30 days = 10/day) → 310 kWh → 930 + 60 = R990,00;
//      the 1 November reading later shows 330 kWh → true-up (330 − 310) × 3 = R60,00.
//   F7 electricity bought by the tenant directly (prepaid) → nothing.
//   Disputed charge cannot be approved until resolved; a credit after invoicing is recorded against the lease.
// Q "Hilltop Farmhouse": private-only (solar, battery, borehole, tank), no tariffs, doesn't resell → monitoring only.
// R "Station Flats": municipal-only, two flats metered → bills without any supply sources.

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
delete process.env.RESEND_API_KEY;
delete process.env.SMART_UTILITY_TENANT_STATEMENTS_ENABLED;

const billing = await import('../billing');
const { loadHybridDashboard } = await import('../hybridDashboard');
const { loadSmartUtilityOverview } = await import('../overview');
const { loadUtilityPortfolio } = await import('../portfolio');
const { sastInstant } = await import('../consumption');

const URL_ = 'http://127.0.0.1:54321';
let reachable = false;
try {
  reachable = (await fetch(`${URL_}/auth/v1/health`)).ok;
} catch {
  reachable = false;
}
const d = reachable ? describe : describe.skip;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service: SupabaseClient = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts);
const SEP = { periodStart: '2026-09-01', periodEnd: '2026-10-01' };
const OCT = { periodStart: '2026-10-01', periodEnd: '2026-11-01' };

d('pilot scenario (real local Supabase)', () => {
  const sfx = Date.now();
  let orgId: string;
  let userId: string;
  let staff: SupabaseClient;
  let P: string;
  let Q: string;
  let R: string;
  const u: Record<string, string> = {};
  const meters: Record<string, string> = {};
  const nonBillable: string[] = [];

  const ins = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await service.from(table).insert(row).select('id').single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data!.id as string;
  };
  const lease = async (unitId: string, start: string, end: string | null, status: string, name: string) => {
    const tenantId = await ins('tenants', { org_id: orgId, full_name: name, status: 'active' });
    const leaseId = await ins('leases', { org_id: orgId, unit_id: unitId, start_date: start, end_date: end, rent_amount: 6000, status });
    await service.from('lease_tenants').insert({ lease_id: leaseId, tenant_id: tenantId, is_primary: true });
  };
  const meter = async (property: string, row: Record<string, unknown>, readings: [number, number, number, number][]) => {
    const id = await ins('utility_meters', { org_id: orgId, property_id: property, responsibility_mode: 'owner_paid', ...row });
    if (readings.length) {
      const { error } = await service.from('meter_telemetry_readings').insert(
        readings.map(([y, m, day, v]) => ({ org_id: orgId, property_id: property, meter_id: id, read_at: sastInstant(y, m, day).toISOString(), raw_value: v, multiplier: 1, value: v, source: 'device', status: 'valid' })),
      );
      if (error) throw new Error(error.message);
    }
    return id;
  };
  const oct = (from: number, to: number): [number, number, number, number][] => [[2026, 10, 1, from], [2026, 11, 1, to]];
  const source = async (property: string, utility: string, type: string, name: string, extra: Record<string, unknown> = {}) =>
    ins('utility_supply_sources', { org_id: orgId, property_id: property, utility_type: utility, source_type: type, name, ...extra });
  const arr = (property: string, unit: string, utility: string, arrangement: string, extra: Record<string, unknown> = {}) => ({
    org_id: orgId, property_id: property, unit_id: unit, utility_type: utility, arrangement, effective_from: '2026-01-01', invoice_mode: 'separate_invoice', ...extra,
  });
  const live = async (property: string) =>
    (await service.from('utility_charges').select('*, units(unit_label)').eq('property_id', property).neq('status', 'void')).data ?? [];
  const octOf = async (label: string, utility: string) =>
    (await live(P))
      .filter((c) => c.units?.unit_label === label && c.utility_type === utility && c.period_start === '2026-10-01' && c.charge_type !== 'true_up')
      .map((c) => `${c.charge_type}:${Number(c.total_amount).toFixed(2)}`)
      .sort();

  beforeAll(async () => {
    const email = `pilot-${sfx}@propertyvault.example`;
    userId = (await service.auth.admin.createUser({ email, password: 'TestPassw0rd!23', email_confirm: true })).data.user!.id;
    orgId = await ins('organizations', { legal_name: `PILOT ${sfx}`, org_type: 'agency' });
    await service.from('organization_members').insert({ org_id: orgId, user_id: userId, role: 'accountant', status: 'active', joined_at: new Date().toISOString(), property_access_mode: 'all' });
    staff = createClient(URL_, ANON_KEY, opts);
    await staff.auth.signInWithPassword({ email, password: 'TestPassw0rd!23' });

    // ---------------------------------------------------------------- P: hybrid
    P = await ins('properties', { org_id: orgId, nickname: 'Protea Gardens', address_line1: '9 Protea Rd', city: 'Pietermaritzburg', province: 'KwaZulu-Natal', postal_code: '3201' });
    for (let i = 1; i <= 7; i++) u[`F${i}`] = await ins('units', { org_id: orgId, property_id: P, unit_label: `F${i}` });
    for (const f of ['F1', 'F2', 'F3', 'F4', 'F6', 'F7']) await lease(u[f]!, '2026-01-01', null, 'active', `Tenant ${f}`);
    await lease(u.F5!, '2025-06-01', '2026-10-15', 'terminated', 'Tenant F5 out');
    await lease(u.F5!, '2026-10-16', null, 'active', 'Tenant F5 in');

    const grid = await source(P, 'electricity', 'municipal_grid', 'Eskom/municipal supply');
    const pv = await source(P, 'electricity', 'solar_pv', 'Roof PV');
    const bat = await source(P, 'electricity', 'battery', 'Battery');
    const gen = await source(P, 'electricity', 'generator', 'Generator', { fuel_type: 'diesel' });
    const muni = await source(P, 'water', 'municipal', 'Municipal water');
    const bh = await source(P, 'water', 'borehole', 'Borehole');
    const tank = await source(P, 'water', 'storage_tank', 'JoJo', { capacity_value: 5000, capacity_unit: 'litres', low_level_pct: 20 });

    // Never billable: every hybrid register, both main consumption meters, the shared meter's sources.
    nonBillable.push(await meter(P, { utility_type: 'electricity', meter_role: 'main', measurement_kind: 'grid_import', supply_source_id: grid }, oct(10_000, 10_400)));
    nonBillable.push(await meter(P, { utility_type: 'electricity', meter_role: 'check', measurement_kind: 'generation', supply_source_id: pv }, oct(0, 900)));
    nonBillable.push(await meter(P, { utility_type: 'electricity', meter_role: 'check', measurement_kind: 'battery_charge', supply_source_id: bat }, oct(0, 300)));
    nonBillable.push(await meter(P, { utility_type: 'electricity', meter_role: 'check', measurement_kind: 'battery_discharge', supply_source_id: bat }, oct(0, 270)));
    nonBillable.push(await meter(P, { utility_type: 'electricity', meter_role: 'check', measurement_kind: 'generator_output', supply_source_id: gen }, oct(0, 50)));
    nonBillable.push(await meter(P, { utility_type: 'electricity', meter_role: 'check', measurement_kind: 'pump_energy', supply_source_id: bh }, oct(0, 120)));
    nonBillable.push(await meter(P, { utility_type: 'electricity', meter_role: 'main', measurement_kind: 'consumption' }, oct(0, 1300)));
    nonBillable.push(await meter(P, { utility_type: 'water', meter_role: 'check', measurement_kind: 'source_supply', supply_source_id: muni }, oct(0, 30_000)));
    nonBillable.push(await meter(P, { utility_type: 'water', meter_role: 'check', measurement_kind: 'source_supply', supply_source_id: bh }, oct(0, 15_000)));
    nonBillable.push(await meter(P, { utility_type: 'water', meter_role: 'main', measurement_kind: 'consumption' }, oct(0, 45_000)));
    await service.from('utility_source_readings').insert([
      { org_id: orgId, property_id: P, source_id: tank, metric: 'tank_level_pct', read_at: sastInstant(2026, 10, 1).toISOString(), value: 40, source: 'manual' },
      { org_id: orgId, property_id: P, source_id: tank, metric: 'tank_level_pct', read_at: sastInstant(2026, 11, 1).toISOString(), value: 60, source: 'manual' },
    ]);
    await service.from('utility_source_logs').insert([
      { org_id: orgId, property_id: P, source_id: tank, log_type: 'tanker_delivery', occurred_at: sastInstant(2026, 10, 10, 9).toISOString(), quantity: 2, quantity_unit: 'kL', cost_amount: 900 },
      { org_id: orgId, property_id: P, source_id: gen, log_type: 'fuel_purchase', occurred_at: sastInstant(2026, 10, 12, 9).toISOString(), quantity: 25, quantity_unit: 'litres', cost_amount: 500 },
    ]);

    // Billable unit meters (kWh / litres)
    const sub = (f: string, utility: string) => ({ unit_id: u[f], utility_type: utility, meter_role: 'submeter', measurement_kind: 'consumption' });
    meters.F1e = await meter(P, sub('F1', 'electricity'), oct(0, 200));
    meters.F1w = await meter(P, sub('F1', 'water'), oct(0, 8_000));
    meters.F2e = await meter(P, sub('F2', 'electricity'), oct(0, 150));
    meters.F2w = await meter(P, sub('F2', 'water'), oct(0, 5_000));
    meters.F3e = await meter(P, sub('F3', 'electricity'), oct(0, 130));
    meters.F5e = await meter(P, sub('F5', 'electricity'), [[2026, 10, 1, 0], [2026, 10, 16, 50], [2026, 11, 1, 90]]);
    meters.F6e = await meter(P, sub('F6', 'electricity'), [[2026, 9, 1, 0], [2026, 10, 1, 300]]); // no 1 November reading (yet)
    const shared = await meter(P, { utility_type: 'water', meter_role: 'check', measurement_kind: 'consumption', location: 'F4+F7 shared' }, oct(0, 20_000));

    await service.from('utility_tariffs').insert([
      { org_id: orgId, property_id: P, utility_type: 'electricity', name: 'FICTIONAL flat R3', tariff_kind: 'flat', fixed_charge: 60, blocks: [{ upTo: null, rate: 3 }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-01-01' },
      { org_id: orgId, property_id: P, utility_type: 'water', name: 'FICTIONAL water blocks', tariff_kind: 'block', fixed_charge: 0, blocks: [{ upTo: 6, rate: 20 }, { upTo: 15, rate: 30 }, { upTo: null, rate: 50 }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-01-01' },
    ]);
    const group = await ins('utility_allocation_groups', { org_id: orgId, property_id: P, meter_id: shared, name: 'F4+F7 water', method: 'equal', landlord_share_pct: 0 });
    await service.from('utility_allocation_members').insert(['F4', 'F7'].map((f) => ({ group_id: group, org_id: orgId, property_id: P, unit_id: u[f] })));
    const { error } = await service.from('utility_billing_arrangements').insert([
      arr(P, u.F1!, 'electricity', 'metered_recharge'),
      arr(P, u.F1!, 'water', 'metered_recharge'),
      arr(P, u.F2!, 'electricity', 'included_in_rent'),
      arr(P, u.F2!, 'water', 'landlord_paid'),
      arr(P, u.F3!, 'electricity', 'fixed_allowance', { fixed_amount: 400, allowance_quantity: 100 }),
      arr(P, u.F4!, 'electricity', 'fixed_allowance', { fixed_amount: 350, allowance_quantity: null }),
      arr(P, u.F4!, 'water', 'shared_allocation', { allocation_group_id: group }),
      arr(P, u.F5!, 'electricity', 'metered_recharge'),
      arr(P, u.F6!, 'electricity', 'metered_recharge'),
      arr(P, u.F7!, 'electricity', 'tenant_direct'),
      arr(P, u.F7!, 'water', 'shared_allocation', { allocation_group_id: group }),
    ]);
    if (error) throw new Error(error.message);

    // F6's September history (actual readings) — the basis for its October estimate. Everything else that a
    // September run produces (units without September readings) is voided: the pilot starts billing in October.
    await billing.generateCharges(service, { propertyId: P, ...SEP, actorUserId: userId });
    const sep = (await live(P)).filter((c) => c.period_start === '2026-09-01');
    const f6Sep = sep.find((c) => c.unit_id === u.F6);
    expect(Number(f6Sep?.total_amount)).toBe(960); // 300 × 3 + 60
    await billing.voidCharges(service, { chargeIds: sep.filter((c) => c.unit_id !== u.F6).map((c) => c.id), propertyId: P, actorUserId: userId });

    // ---------------------------------------------------------------- Q: private-only, monitoring only
    Q = await ins('properties', { org_id: orgId, nickname: 'Hilltop Farmhouse', address_line1: '1 Hilltop', city: 'Howick', province: 'KwaZulu-Natal', postal_code: '3290' });
    u.Q1 = await ins('units', { org_id: orgId, property_id: Q, unit_label: 'Cottage' });
    u.Q2 = await ins('units', { org_id: orgId, property_id: Q, unit_label: 'Studio' });
    await lease(u.Q1, '2026-01-01', null, 'active', 'Cottage tenant');
    await lease(u.Q2, '2026-01-01', null, 'active', 'Studio tenant');
    const qpv = await source(Q, 'electricity', 'solar_pv', 'PV');
    const qbat = await source(Q, 'electricity', 'battery', 'Battery');
    const qbh = await source(Q, 'water', 'borehole', 'Borehole');
    await source(Q, 'water', 'storage_tank', 'Tank', { capacity_value: 10_000, capacity_unit: 'litres' });
    nonBillable.push(await meter(Q, { utility_type: 'electricity', meter_role: 'check', measurement_kind: 'generation', supply_source_id: qpv }, oct(0, 600)));
    nonBillable.push(await meter(Q, { utility_type: 'electricity', meter_role: 'check', measurement_kind: 'battery_discharge', supply_source_id: qbat }, oct(0, 150)));
    nonBillable.push(await meter(Q, { utility_type: 'water', meter_role: 'check', measurement_kind: 'source_supply', supply_source_id: qbh }, oct(0, 12_000)));
    await meter(Q, sub('Q1', 'electricity'), oct(0, 220));
    await meter(Q, sub('Q2', 'electricity'), oct(0, 180));
    // Cottage: included in rent. Studio: someone ticked "metered recharge" but no tariff exists → refused, not guessed.
    await service.from('utility_billing_arrangements').insert([arr(Q, u.Q1, 'electricity', 'included_in_rent'), arr(Q, u.Q2, 'electricity', 'metered_recharge')]);

    // ---------------------------------------------------------------- R: municipal-only
    R = await ins('properties', { org_id: orgId, nickname: 'Station Flats', address_line1: '4 Station Rd', city: 'Durban', province: 'KwaZulu-Natal', postal_code: '4001' });
    u.R1 = await ins('units', { org_id: orgId, property_id: R, unit_label: 'Flat A' });
    u.R2 = await ins('units', { org_id: orgId, property_id: R, unit_label: 'Flat B' });
    await lease(u.R1, '2026-01-01', null, 'active', 'Flat A tenant');
    await lease(u.R2, '2026-01-01', null, 'active', 'Flat B tenant');
    await meter(R, sub('R1', 'water'), oct(0, 4_000));
    await meter(R, sub('R2', 'water'), oct(0, 16_000));
    await service.from('utility_tariffs').insert({ org_id: orgId, property_id: R, utility_type: 'water', name: 'FICTIONAL water blocks', tariff_kind: 'block', fixed_charge: 0, blocks: [{ upTo: 6, rate: 20 }, { upTo: 15, rate: 30 }, { upTo: null, rate: 50 }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-01-01' });
    await service.from('utility_billing_arrangements').insert([arr(R, u.R1, 'water', 'metered_recharge'), arr(R, u.R2, 'water', 'metered_recharge')]);
  }, 180_000);

  it('P: every arrangement bills exactly the hand-computed amount', async () => {
    const r = await billing.generateCharges(service, { propertyId: P, ...OCT, actorUserId: userId, estimateMissing: true });
    expect(r.created).toBe(10);
    expect(await octOf('F1', 'electricity')).toEqual(['consumption:660.00']);
    expect(await octOf('F1', 'water')).toEqual(['consumption:180.00']);
    expect(await octOf('F2', 'electricity')).toEqual([]); // included in rent
    expect(await octOf('F2', 'water')).toEqual([]); // landlord pays
    expect(await octOf('F3', 'electricity')).toEqual(['allowance_fee:400.00', 'excess:90.00']);
    expect(await octOf('F4', 'electricity')).toEqual(['allowance_fee:350.00']);
    expect(await octOf('F4', 'water')).toEqual(['allocation:320.00']);
    expect(await octOf('F7', 'water')).toEqual(['allocation:320.00']);
    expect(await octOf('F5', 'electricity')).toEqual(['consumption:150.97', 'consumption:179.03']);
    expect(await octOf('F6', 'electricity')).toEqual(['consumption:990.00']); // estimated
    expect(await octOf('F7', 'electricity')).toEqual([]); // tenant buys prepaid directly
    expect(r.skipped.map((s) => s.label)).toEqual(expect.arrayContaining(['F2 electricity', 'F2 water', 'F7 electricity']));

    const all = await live(P);
    // Solar, battery, generator, pump, source and main meters never produce a charge; tank levels are not meters.
    for (const c of all) expect(nonBillable).not.toContain(c.meter_id);
    const f5 = all.filter((c) => c.unit_id === u.F5 && c.period_start === '2026-10-01');
    expect(new Set(f5.map((c) => c.lease_id)).size).toBe(2); // two different tenants
    const f6 = all.find((c) => c.unit_id === u.F6 && c.period_start === '2026-10-01')!;
    expect(f6.review_flags).toContain('estimated_consumption_true_up_pending');
    // Independent total of the month: 660 + 180 + 400 + 90 + 350 + 320 + 320 + 179,03 + 150,97 + 990 = R3 640,00
    const total = all.filter((c) => c.period_start === '2026-10-01').reduce((a, c) => a + Math.round(Number(c.total_amount) * 100), 0);
    expect(total).toBe(364_000);
    // Re-running never bills twice.
    expect((await billing.generateCharges(service, { propertyId: P, ...OCT, actorUserId: userId, estimateMissing: true })).created).toBe(0);
  }, 120_000);

  it('P: dispute blocks approval until resolved; credit after invoicing; estimate trued up once readings arrive', async () => {
    const all = (await live(P)).filter((c) => c.period_start === '2026-10-01');
    const f1e = all.find((c) => c.unit_id === u.F1 && c.utility_type === 'electricity')!;
    const f1w = all.find((c) => c.unit_id === u.F1 && c.utility_type === 'water')!;
    const f6 = all.find((c) => c.unit_id === u.F6)!;
    await billing.disputeCharge(service, { chargeId: f1e.id, propertyId: P, action: 'open', text: 'Tenant queries the kWh', actorUserId: userId });
    const appr = await billing.approveCharges(service, { chargeIds: [f1e.id, f1w.id, f6.id], propertyId: P, actorUserId: userId });
    expect(appr).toEqual({ approved: 2, ignored: 1 }); // the disputed charge is not approved
    await billing.disputeCharge(service, { chargeId: f1e.id, propertyId: P, action: 'resolve', text: 'Reading photo checked: correct', actorUserId: userId });
    expect((await billing.approveCharges(service, { chargeIds: [f1e.id], propertyId: P, actorUserId: userId })).approved).toBe(1);

    const inv = await billing.invoiceCharges(staff, service, { chargeIds: [f1e.id, f1w.id], propertyId: P, actorUserId: userId });
    expect(inv.invoices).toHaveLength(1);
    const { data: invoice } = await service.from('invoices').select('status, issued_at').eq('id', inv.invoices[0]!).single();
    expect(invoice).toEqual({ status: 'draft', issued_at: null }); // never issued by the utilities module

    await expect(billing.creditCharge(service, { chargeId: f1w.id, propertyId: P, amount: 181, reason: 'too much', actorUserId: userId })).rejects.toThrow(/exceed/);
    await billing.creditCharge(service, { chargeId: f1w.id, propertyId: P, amount: 30, reason: 'Leak on the landlord side confirmed', actorUserId: userId });
    const { data: credit } = await service.from('utility_credits').select('amount, remaining, lease_id').eq('source_charge_id', f1w.id).single();
    expect(credit).toEqual({ amount: 30, remaining: 30, lease_id: f1w.lease_id });

    // F6's 1 November reading arrives: 330 kWh actually used vs 310 estimated → R60,00 true-up, once.
    await service.from('meter_telemetry_readings').insert({ org_id: orgId, property_id: P, meter_id: meters.F6e, read_at: sastInstant(2026, 11, 1).toISOString(), raw_value: 630, multiplier: 1, value: 630, source: 'device', status: 'valid' });
    expect((await billing.generateCharges(service, { propertyId: P, ...OCT, actorUserId: userId })).created).toBe(1);
    const t = (await live(P)).find((c) => c.charge_type === 'true_up')!;
    expect(t).toMatchObject({ unit_id: u.F6, status: 'draft' });
    expect(Number(t.total_amount)).toBe(60);
    expect(Number(t.consumption)).toBe(20);
    expect((await billing.generateCharges(service, { propertyId: P, ...OCT, actorUserId: userId })).created).toBe(0);
  }, 120_000);

  it('P: the hybrid dashboard balances the site and shows unit use without billing hybrid registers', async () => {
    const dash = await loadHybridDashboard(staff, P, { from: '2026-10-01', to: '2026-11-01' });
    // 400 grid + 900 solar + 50 generator + 270 discharge − 300 charge = 1 320 kWh into the site; 1 300 measured
    expect(dash.electricity.siteSupply).toEqual({ value: 1320, basis: 'derived' });
    expect(dash.electricity.measuredConsumption.value).toBe(1300);
    expect(dash.electricity.pumpEnergy.value).toBe(120);
    // 30 municipal + 15 borehole + 2 tanker = 47 kL; tank +1 kL (40 % → 60 % of 5 000 L) stored → 46 kL used
    expect(dash.water.totalSupply.value).toBe(47);
    expect(dash.water.storageChange.value).toBe(1);
    expect(dash.water.siteUse.value).toBe(46);
  }, 60_000);

  it('Q: a private-only, non-reselling property works with no tariffs at all', async () => {
    const r = await billing.generateCharges(service, { propertyId: Q, ...OCT, actorUserId: userId });
    expect(r.created).toBe(0);
    expect(await live(Q)).toEqual([]);
    expect(r.skipped.find((s) => s.unitId === u.Q1)?.reason).toMatch(/nothing to recharge/);
    expect(r.skipped.find((s) => s.unitId === u.Q2)?.reason).toMatch(/No electricity tariff effective/);
    const dash = await loadHybridDashboard(staff, Q, { from: '2026-10-01', to: '2026-11-01' });
    expect(dash.units.map((x) => [x.unitLabel, x.electricity?.consumption]).sort()).toEqual([
      ['Cottage', 220],
      ['Studio', 180],
    ]);
    const overview = await loadSmartUtilityOverview(staff, Q);
    expect(overview).toBeTruthy();
    const portfolio = await loadUtilityPortfolio(staff);
    expect(JSON.stringify(portfolio)).toContain('Hilltop Farmhouse');
  }, 60_000);

  it('R: a municipal-only property bills from unit meters alone', async () => {
    const r = await billing.generateCharges(service, { propertyId: R, ...OCT, actorUserId: userId });
    expect(r.created).toBe(2);
    const by = Object.fromEntries((await live(R)).map((c) => [c.units.unit_label, Number(c.total_amount)]));
    // 4 kL = 4×20 = R80,00; 16 kL = 6×20 + 9×30 + 1×50 = R440,00
    expect(by).toEqual({ 'Flat A': 80, 'Flat B': 440 });
  }, 60_000);
});
