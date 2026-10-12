import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Billing reconciliation against an INDEPENDENT expected-results dataset (fixtures/reconciliation-expected.json,
// hand-calculated before the engine ran; docs/UTILITIES_BILLING_RECONCILIATION.md). FICTIONAL tariffs. Covers the
// cases the other suites did not: VAT-exclusive pricing with half-up rounding, block water, a unit tariff change
// mid-period, meter replacement, a shared ELECTRICITY meter, prepaid / Eskom-direct / rainwater monitoring, a
// seasonal tariff, and invoice void -> regenerate without duplicates. Real local Supabase.

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
delete process.env.RESEND_API_KEY;

type ExpectedCharge = { unit?: string; type: string; segmentStart?: string; inclCents: number; exclCents?: number; vatCents?: number };
const EXPECTED = JSON.parse(readFileSync(new URL('./fixtures/reconciliation-expected.json', import.meta.url), 'utf8')) as {
  cases: { id: string; charges: ExpectedCharge[] }[];
  invoices: { expected: { liveInvoicesForCharge: number; voidedInvoices: number; issued: number } };
};
const expectedFor = (id: string) => EXPECTED.cases.find((c) => c.id === id)!.charges;

const billing = await import('../billing');
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
const OCT = { periodStart: '2026-10-01', periodEnd: '2026-11-01' };
const JUL = { periodStart: '2026-07-01', periodEnd: '2026-08-01' };

d('billing reconciliation vs independent expected results (real local Supabase)', () => {
  const sfx = Date.now();
  let orgId: string;
  let userId: string;
  let session: SupabaseClient;
  let P: string;
  let P2: string;
  const u: Record<string, string> = {};
  const nonBillable: string[] = [];

  const ins = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await service.from(table).insert(row).select('id').single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data!.id as string;
  };
  const read = (property: string, meterId: string, y: number, m: number, day: number, v: number) => ({
    org_id: orgId, property_id: property, meter_id: meterId, read_at: sastInstant(y, m, day).toISOString(), raw_value: v, multiplier: 1, value: v, source: 'device', status: 'valid',
  });
  const meter = async (property: string, row: Record<string, unknown>, readings: [number, number, number, number][]) => {
    const id = await ins('utility_meters', { org_id: orgId, property_id: property, responsibility_mode: 'owner_paid', ...row });
    if (readings.length) {
      const { error } = await service.from('meter_telemetry_readings').insert(readings.map(([y, mo, day, v]) => read(property, id, y, mo, day, v)));
      if (error) throw new Error(error.message);
    }
    return id;
  };
  const unitWithLease = async (property: string, label: string) => {
    const unitId = await ins('units', { org_id: orgId, property_id: property, unit_label: label });
    const tenantId = await ins('tenants', { org_id: orgId, full_name: `Tenant ${label}`, status: 'active' });
    const leaseId = await ins('leases', { org_id: orgId, unit_id: unitId, start_date: '2026-01-01', end_date: null, rent_amount: 7000, status: 'active' });
    await service.from('lease_tenants').insert({ lease_id: leaseId, tenant_id: tenantId, is_primary: true });
    u[label] = unitId;
    return unitId;
  };
  const arr = (property: string, label: string, utility: string, arrangement: string, extra: Record<string, unknown> = {}) => ({
    org_id: orgId, property_id: property, unit_id: u[label], utility_type: utility, arrangement, effective_from: '2026-01-01', invoice_mode: 'separate_invoice', ...extra,
  });
  const live = async (property: string) =>
    (await service.from('utility_charges').select('*, units(unit_label)').eq('property_id', property).neq('status', 'void').order('segment_start')).data ?? [];

  beforeAll(async () => {
    const email = `rec-${sfx}@propertyvault.example`;
    userId = (await service.auth.admin.createUser({ email, password: 'TestPassw0rd!23', email_confirm: true })).data.user!.id;
    orgId = await ins('organizations', { legal_name: `REC ${sfx}`, org_type: 'agency', utilities_enabled: true });
    await service.from('organization_members').insert({ org_id: orgId, user_id: userId, role: 'accountant', status: 'active', joined_at: new Date().toISOString(), property_access_mode: 'all' });
    session = createClient(URL_, ANON_KEY, opts);
    await session.auth.signInWithPassword({ email, password: 'TestPassw0rd!23' });

    // ---------------------------------------------------------------- P: October, mixed cases
    P = await ins('properties', { org_id: orgId, nickname: 'Reconciliation Towers', address_line1: '5 Ledger Rd', city: 'Pretoria', province: 'Gauteng', postal_code: '0002' });
    for (const l of ['R1', 'R2', 'R4', 'R5', 'R6a', 'R6b', 'R7']) await unitWithLease(P, l);
    const oct = (a: number, b: number): [number, number, number, number][] => [[2026, 10, 1, a], [2026, 11, 1, b]];
    const sub = (label: string, utility: string, extra: Record<string, unknown> = {}) => ({ unit_id: u[label], utility_type: utility, meter_role: 'submeter', measurement_kind: 'consumption', ...extra });

    await meter(P, sub('R1', 'electricity'), oct(0, 123));
    await meter(P, sub('R2', 'water'), oct(0, 18_000));
    await meter(P, sub('R4', 'electricity'), [[2026, 10, 1, 0], [2026, 10, 16, 150], [2026, 11, 1, 310]]);
    // R5: meter replaced on 12 October (old 0 -> 80, new 0 -> 70).
    const oldMeter = await meter(P, sub('R5', 'electricity', { active: false, decommissioned_at: sastInstant(2026, 10, 12).toISOString(), serial_number: 'OLD-R5' }), [[2026, 10, 1, 0], [2026, 10, 12, 80]]);
    await meter(P, sub('R5', 'electricity', { replaced_meter_id: oldMeter, serial_number: 'NEW-R5' }), [[2026, 10, 12, 0], [2026, 11, 1, 70]]);
    const sharedElec = await meter(P, { utility_type: 'electricity', meter_role: 'check', measurement_kind: 'consumption', location: 'R6 shared DB' }, oct(0, 300));
    // R7: prepaid meter bought by the tenant; site also has Eskom-direct supply and rainwater harvesting.
    await meter(P, sub('R7', 'electricity', { is_prepaid: true }), oct(0, 40));
    const eskom = await ins('utility_supply_sources', { org_id: orgId, property_id: P, utility_type: 'electricity', source_type: 'eskom_direct', name: 'Eskom direct' });
    await ins('utility_supply_sources', { org_id: orgId, property_id: P, utility_type: 'electricity', source_type: 'prepaid', name: 'Prepaid vending' });
    const rain = await ins('utility_supply_sources', { org_id: orgId, property_id: P, utility_type: 'water', source_type: 'rainwater', name: 'Rainwater tanks' });
    nonBillable.push(await meter(P, { utility_type: 'electricity', meter_role: 'main', measurement_kind: 'grid_import', supply_source_id: eskom }, oct(5_000, 5_900)));
    nonBillable.push(await meter(P, { utility_type: 'water', meter_role: 'check', measurement_kind: 'source_supply', supply_source_id: rain }, oct(0, 9_000)));
    nonBillable.push(sharedElec); // only ever billed via the allocation group, never directly

    const { error: tErr } = await service.from('utility_tariffs').insert([
      { org_id: orgId, property_id: P, utility_type: 'electricity', name: 'FICTIONAL E_EXCL', tariff_kind: 'flat', fixed_charge: 50, blocks: [{ upTo: null, rate: 2.5 }], vat_inclusive: false, vat_rate: 15, effective_from: '2026-01-01' },
      { org_id: orgId, property_id: P, utility_type: 'water', name: 'FICTIONAL W_BLOCK', tariff_kind: 'block', fixed_charge: 0, blocks: [{ upTo: 6, rate: 20 }, { upTo: 15, rate: 30 }, { upTo: null, rate: 50 }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-01-01' },
      { org_id: orgId, property_id: P, unit_id: u.R4, utility_type: 'electricity', name: 'FICTIONAL E_R4_A', tariff_kind: 'flat', fixed_charge: 0, blocks: [{ upTo: null, rate: 3 }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-01-01', effective_to: '2026-10-15' },
      { org_id: orgId, property_id: P, unit_id: u.R4, utility_type: 'electricity', name: 'FICTIONAL E_R4_B', tariff_kind: 'flat', fixed_charge: 0, blocks: [{ upTo: null, rate: 3.3 }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-10-16' },
    ]);
    if (tErr) throw new Error(tErr.message);
    const group = await ins('utility_allocation_groups', { org_id: orgId, property_id: P, meter_id: sharedElec, name: 'R6 shared electricity', method: 'equal', landlord_share_pct: 0 });
    await service.from('utility_allocation_members').insert(['R6a', 'R6b'].map((l) => ({ group_id: group, org_id: orgId, property_id: P, unit_id: u[l] })));
    const { error: aErr } = await service.from('utility_billing_arrangements').insert([
      arr(P, 'R1', 'electricity', 'metered_recharge'),
      arr(P, 'R2', 'water', 'metered_recharge'),
      arr(P, 'R4', 'electricity', 'metered_recharge'),
      arr(P, 'R5', 'electricity', 'metered_recharge'),
      arr(P, 'R6a', 'electricity', 'shared_allocation', { allocation_group_id: group }),
      arr(P, 'R6b', 'electricity', 'shared_allocation', { allocation_group_id: group }),
      arr(P, 'R7', 'electricity', 'tenant_direct'),
    ]);
    if (aErr) throw new Error(aErr.message);

    // ---------------------------------------------------------------- P2: July, seasonal tariff
    P2 = await ins('properties', { org_id: orgId, nickname: 'Season House', address_line1: '6 Winter Rd', city: 'Bloemfontein', province: 'Free State', postal_code: '9301' });
    await unitWithLease(P2, 'S1');
    await meter(P2, { unit_id: u.S1, utility_type: 'electricity', meter_role: 'submeter', measurement_kind: 'consumption' }, [[2026, 7, 1, 0], [2026, 8, 1, 100]]);
    await ins('utility_tariffs', {
      org_id: orgId, property_id: P2, utility_type: 'electricity', name: 'FICTIONAL E_SEASON', tariff_kind: 'block', fixed_charge: 0,
      blocks: [{ upTo: null, rate: 2 }], seasons: [{ name: 'Winter', months: [6, 7, 8], blocks: [{ upTo: null, rate: 4 }] }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-01-01',
    });
    await ins('utility_billing_arrangements', arr(P2, 'S1', 'electricity', 'metered_recharge'));
  }, 120_000);

  it('every October charge equals the independently calculated amount', async () => {
    await billing.generateCharges(service, { propertyId: P, ...OCT, actorUserId: userId });
    const all = await live(P);
    const actual = (label: string) =>
      all
        .filter((c) => c.units?.unit_label === label)
        .map((c) => ({ type: c.charge_type, segmentStart: c.segment_start, inclCents: Math.round(Number(c.total_amount) * 100), exclCents: Math.round(Number(c.amount_excl_vat) * 100), vatCents: Math.round(Number(c.vat_amount) * 100) }));

    const r1 = actual('R1');
    expect(r1).toHaveLength(1);
    expect(r1[0]).toMatchObject(expectedFor('R1')[0]!); // incl, excl and VAT, half-up per line
    expect(actual('R2').map((c) => c.inclCents)).toEqual(expectedFor('R2').map((c) => c.inclCents));
    expect(actual('R4').map((c) => [c.segmentStart, c.inclCents])).toEqual(expectedFor('R4').map((c) => [c.segmentStart, c.inclCents]));
    expect(actual('R5').map((c) => c.inclCents)).toEqual(expectedFor('R5').map((c) => c.inclCents));
    for (const e of expectedFor('R6')) expect(actual(e.unit!).map((c) => [c.type, c.inclCents])).toEqual([[e.type, e.inclCents]]);
    expect(actual('R7')).toEqual([]); // prepaid, tenant buys directly
    for (const c of all) if (c.charge_type !== 'allocation') expect(nonBillable).not.toContain(c.meter_id);
    // Re-running bills nothing twice.
    expect((await billing.generateCharges(service, { propertyId: P, ...OCT, actorUserId: userId })).created).toBe(0);
  }, 120_000);

  it('a seasonal tariff applies the winter rate in July', async () => {
    await billing.generateCharges(service, { propertyId: P2, ...JUL, actorUserId: userId });
    const s1 = (await live(P2)).map((c) => Math.round(Number(c.total_amount) * 100));
    expect(s1).toEqual(expectedFor('S1').map((c) => c.inclCents));
  }, 60_000);

  it('invoices stay drafts; invoicing twice creates nothing; void releases the charge and re-invoicing makes one new draft', async () => {
    const r1 = (await live(P)).find((c) => c.unit_id === u.R1)!;
    await billing.approveCharges(service, { chargeIds: [r1.id], propertyId: P, actorUserId: userId });
    const first = await billing.invoiceCharges(session, service, { chargeIds: [r1.id], propertyId: P, actorUserId: userId });
    expect(first.invoices).toHaveLength(1);
    await expect(billing.invoiceCharges(session, service, { chargeIds: [r1.id], propertyId: P, actorUserId: userId })).rejects.toThrow(); // already invoiced
    expect((await session.rpc('void_invoice', { p_invoice_id: first.invoices[0], p_reason: 'Reconciliation test: regenerate' })).error).toBeNull();
    const second = await billing.invoiceCharges(session, service, { chargeIds: [r1.id], propertyId: P, actorUserId: userId });
    expect(second.invoices).toHaveLength(1);
    const { data: invs } = await service.from('invoices').select('id, status, issued_at, voided_at').in('id', [...first.invoices, ...second.invoices]);
    const want = EXPECTED.invoices.expected;
    expect(invs!.filter((i) => !i.voided_at)).toHaveLength(want.liveInvoicesForCharge);
    expect(invs!.filter((i) => i.voided_at)).toHaveLength(want.voidedInvoices);
    expect(invs!.filter((i) => i.issued_at)).toHaveLength(want.issued);
    expect(invs!.find((i) => !i.voided_at)!.status).toBe('draft');
    const { data: after } = await service.from('utility_charges').select('status, invoice_id').eq('id', r1.id).single();
    expect(after).toEqual({ status: 'invoiced', invoice_id: second.invoices[0] });
  }, 120_000);
});
