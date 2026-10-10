import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Utility billing v2 against a real local Supabase (docs/HYBRID_UTILITIES_ARCHITECTURE.md §E).
// A small Durban block (rates illustrative, entered as the owner would — never a built-in tariff):
//   Flat A (60 m²): water metered recharge (block tariff), electricity shared with vacant Flat C (floor area, 10 %
//                   landlord share), invoice mode "with draft invoice".
//   Flat B (40 m²): electricity metered recharge with a move-out on 15 Sep and a move-in on 16 Sep; water landlord-paid.
//   Flat C (30 m²): vacant; has a water meter but NO arrangement → never charged.

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
delete process.env.RESEND_API_KEY;

const billing = await import('../billing');
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

describeIfSupabase('utility billing v2 (real local Supabase integration)', () => {
  const suffix = Date.now();
  let orgId: string;
  let propertyId: string;
  let userId: string;
  let session: SupabaseClient;
  const unit: Record<'A' | 'B' | 'C', string> = { A: '', B: '', C: '' };
  const lease: Record<'A' | 'B1' | 'B2', string> = { A: '', B1: '', B2: '' };
  const tenant: Record<'A' | 'B1' | 'B2', string> = { A: '', B1: '', B2: '' };
  const meter: Record<'waterA' | 'elecB' | 'common' | 'waterC', string> = { waterA: '', elecB: '', common: '', waterC: '' };

  const reading = (meterId: string, y: number, m: number, d: number, raw: number) => ({
    org_id: orgId,
    property_id: propertyId,
    meter_id: meterId,
    read_at: sastInstant(y, m, d).toISOString(),
    raw_value: raw,
    multiplier: 1,
    value: raw,
    source: 'device',
  });
  const charges = async () =>
    (await service.from('utility_charges').select('*').eq('property_id', propertyId).order('created_at')).data ?? [];

  beforeAll(async () => {
    const { data: user } = await service.auth.admin.createUser({ email: `hyb-${suffix}@propertyvault.example`, password: 'TestPassw0rd!23', email_confirm: true });
    userId = user.user!.id;
    const { data: org } = await service.from('organizations').insert({ legal_name: `HYB ${suffix}`, org_type: 'agency' }).select('id').single();
    orgId = org!.id;
    await service.from('organization_members').insert({ org_id: orgId, user_id: userId, role: 'accountant', status: 'active', joined_at: new Date().toISOString(), property_access_mode: 'all' });
    session = createClient(SUPABASE_URL, ANON_KEY, opts);
    const { error: signInError } = await session.auth.signInWithPassword({ email: `hyb-${suffix}@propertyvault.example`, password: 'TestPassw0rd!23' });
    expect(signInError).toBeNull();

    const { data: prop } = await service.from('properties').insert({ org_id: orgId, nickname: 'HYB', address_line1: '9', city: 'Durban', province: 'KwaZulu-Natal', postal_code: '4001' }).select('id').single();
    propertyId = prop!.id;
    for (const [k, size] of [['A', 60], ['B', 40], ['C', 30]] as const) {
      const { data } = await service.from('units').insert({ org_id: orgId, property_id: propertyId, unit_label: `Flat ${k}`, size_sqm: size }).select('id').single();
      unit[k] = data!.id;
    }
    const addLease = async (key: 'A' | 'B1' | 'B2', unitId: string, start: string, end: string | null, status: string) => {
      const { data: t } = await service.from('tenants').insert({ org_id: orgId, full_name: `Tenant ${key}`, status: 'active' }).select('id').single();
      tenant[key] = t!.id;
      const { data: l } = await service.from('leases').insert({ org_id: orgId, unit_id: unitId, start_date: start, end_date: end, rent_amount: 7000, status }).select('id').single();
      lease[key] = l!.id;
      await service.from('lease_tenants').insert({ lease_id: l!.id, tenant_id: t!.id, is_primary: true });
    };
    await addLease('A', unit.A, '2026-01-01', null, 'active');
    await addLease('B1', unit.B, '2025-10-01', '2026-09-15', 'terminated'); // moves out 15 Sep (inclusive)
    await addLease('B2', unit.B, '2026-09-16', null, 'active'); // moves in 16 Sep

    const addMeter = async (row: Record<string, unknown>) =>
      (await service.from('utility_meters').insert({ org_id: orgId, property_id: propertyId, responsibility_mode: 'owner_paid', ...row }).select('id').single()).data!.id as string;
    meter.waterA = await addMeter({ unit_id: unit.A, utility_type: 'water', meter_role: 'submeter' });
    meter.elecB = await addMeter({ unit_id: unit.B, utility_type: 'electricity', meter_role: 'submeter' });
    meter.common = await addMeter({ utility_type: 'electricity', meter_role: 'check', location: 'Common supply A+C' });
    meter.waterC = await addMeter({ unit_id: unit.C, utility_type: 'water', meter_role: 'submeter' });

    // Water registers in litres; electricity in kWh. Readings at SAST midnight boundaries.
    await service.from('meter_telemetry_readings').insert([
      reading(meter.waterA, 2026, 9, 1, 100_000),
      reading(meter.waterA, 2026, 9, 16, 106_000),
      reading(meter.waterA, 2026, 10, 1, 112_000), // 12 kL in September
      reading(meter.waterA, 2026, 10, 16, 116_000),
      reading(meter.waterA, 2026, 11, 1, 120_000), // 8 kL in October
      reading(meter.elecB, 2026, 9, 1, 1000),
      reading(meter.elecB, 2026, 9, 16, 1300), // 300 kWh before move-out
      reading(meter.elecB, 2026, 10, 1, 1500), // 200 kWh after move-in
      reading(meter.common, 2026, 9, 1, 5000),
      reading(meter.common, 2026, 9, 16, 5500),
      reading(meter.common, 2026, 10, 1, 6000), // 1 000 kWh shared
      reading(meter.waterC, 2026, 9, 1, 0),
      reading(meter.waterC, 2026, 10, 1, 3000),
    ]);

    await service.from('utility_tariffs').insert([
      { org_id: orgId, property_id: propertyId, utility_type: 'water', name: 'Water (illustrative)', tariff_kind: 'block', fixed_charge: 0, blocks: [{ upTo: 6, rate: 25 }, { upTo: 15, rate: 35 }, { upTo: null, rate: 50 }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-07-01' },
      { org_id: orgId, property_id: propertyId, utility_type: 'electricity', name: 'Electricity (illustrative)', tariff_kind: 'flat', fixed_charge: 150, blocks: [{ upTo: null, rate: 3 }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-07-01' },
    ]);

    const { data: group } = await service
      .from('utility_allocation_groups')
      .insert({ org_id: orgId, property_id: propertyId, meter_id: meter.common, name: 'Common A+C', method: 'floor_area', landlord_share_pct: 10 })
      .select('id')
      .single();
    await service.from('utility_allocation_members').insert([
      { group_id: group!.id, org_id: orgId, property_id: propertyId, unit_id: unit.A },
      { group_id: group!.id, org_id: orgId, property_id: propertyId, unit_id: unit.C },
    ]);
    const arr = (u: string, utility: string, arrangement: string, extra: Record<string, unknown> = {}) => ({
      org_id: orgId,
      property_id: propertyId,
      unit_id: u,
      utility_type: utility,
      arrangement,
      effective_from: '2026-07-01',
      invoice_mode: 'separate_invoice',
      allocation_group_id: null,
      ...extra,
    });
    const { error: arrError } = await service.from('utility_billing_arrangements').insert([
      arr(unit.A, 'water', 'metered_recharge', { invoice_mode: 'with_draft_invoice' }),
      arr(unit.A, 'electricity', 'shared_allocation', { allocation_group_id: group!.id, invoice_mode: 'with_draft_invoice' }),
      arr(unit.C, 'electricity', 'shared_allocation', { allocation_group_id: group!.id }),
      arr(unit.B, 'electricity', 'metered_recharge'),
      arr(unit.B, 'water', 'landlord_paid'),
    ]);
    expect(arrError).toBeNull();
  }, 60_000);

  it('charges only what an arrangement allows, with exact block, proration, VAT and allocation maths', async () => {
    const result = await billing.generateCharges(service, { propertyId, periodStart: '2026-09-01', periodEnd: '2026-10-01', actorUserId: userId });
    const all = await charges();
    // A water + A shared electricity + B electricity × 2 lease segments = 4
    expect(result.created).toBe(4);
    expect(all).toHaveLength(4);

    // Flat C water: metered but no arrangement → reported, never charged. Flat B water: landlord-paid.
    expect(result.skipped.some((s) => s.unitId === unit.C && /No billing arrangement/.test(s.reason))).toBe(true);
    expect(result.skipped.some((s) => s.unitId === unit.B && /landlord paid/.test(s.reason))).toBe(true);
    expect(result.skipped.some((s) => s.unitId === unit.C && /Vacant/.test(s.reason))).toBe(true);
    expect(all.some((c) => c.unit_id === unit.C)).toBe(false);

    // A water: 12 kL = 6 × R25 + 6 × R35 = R360.00 incl. VAT → excl R313.04, VAT R46.96
    const water = all.find((c) => c.unit_id === unit.A && c.utility_type === 'water')!;
    expect(Number(water.consumption)).toBe(12);
    expect(Number(water.total_amount)).toBe(360);
    expect(Number(water.amount_excl_vat)).toBe(313.04);
    expect(Number(water.vat_amount)).toBe(46.96);
    expect(water.charge_type).toBe('consumption');
    expect(water.review_flags).toContain('water_services_intermediary_review');

    // B electricity, move-out/move-in: 300 kWh × R3 + R150 × 15/30 = R975.00; 200 kWh × R3 + R75 = R675.00
    const b = all.filter((c) => c.unit_id === unit.B).sort((x, y) => String(x.segment_start).localeCompare(String(y.segment_start)));
    expect(b.map((c) => [c.lease_id, c.segment_start, c.segment_end, Number(c.consumption), Number(c.total_amount)])).toEqual([
      [lease.B1, '2026-09-01', '2026-09-16', 300, 975],
      [lease.B2, '2026-09-16', '2026-10-01', 200, 675],
    ]);
    expect(b[0]!.tenant_id).toBe(tenant.B1);
    expect(b[1]!.tenant_id).toBe(tenant.B2);
    expect(b[0]!.review_flags).toContain('electricity_resale_nersa_review');

    // Shared: 1 000 kWh × R3 + R150 = R3 150.00; landlord keeps 10 % → R2 835.00 split 60:30 (A:C) → A R1 890.00.
    // C is vacant, so its R945.00 stays with the landlord (not charged to anyone).
    const shared = all.find((c) => c.unit_id === unit.A && c.charge_type === 'allocation')!;
    expect(Number(shared.total_amount)).toBe(1890);
    expect(shared.review_flags).toContain('shared_meter_allocation_requires_lease_clause');
    expect(shared.calculation.method).toBe('floor_area');
  }, 60_000);

  it('never double-bills: a re-run creates nothing', async () => {
    const again = await billing.generateCharges(service, { propertyId, periodStart: '2026-09-01', periodEnd: '2026-10-01', actorUserId: userId });
    expect(again.created).toBe(0);
    expect(again.existing).toBe(4);
    expect(await charges()).toHaveLength(4);
  }, 60_000);

  it('adjusts drafts with an audit row, blocks disputed charges, and freezes approved ones', async () => {
    const all = await charges();
    const water = all.find((c) => c.unit_id === unit.A && c.utility_type === 'water')!;
    const bOut = all.find((c) => c.lease_id === lease.B1)!;
    const bIn = all.find((c) => c.lease_id === lease.B2)!;

    await expect(billing.adjustCharge(service, { chargeId: water.id, propertyId, amount: -400, reason: 'too much', actorUserId: userId })).rejects.toThrow(/negative/);
    expect((await billing.adjustCharge(service, { chargeId: water.id, propertyId, amount: -10, reason: 'Leak repaired late by landlord', actorUserId: userId })).total).toBe(350);
    const { data: adj } = await service.from('utility_charge_adjustments').select('amount, reason').eq('charge_id', water.id);
    expect(adj).toEqual([{ amount: -10, reason: 'Leak repaired late by landlord' }]);

    await billing.disputeCharge(service, { chargeId: bOut.id, propertyId, action: 'open', text: 'Outgoing tenant disputes the reading', actorUserId: userId });
    const approved = await billing.approveCharges(service, { chargeIds: all.map((c) => c.id), propertyId, actorUserId: userId });
    expect(approved).toEqual({ approved: 3, ignored: 1 });

    await expect(billing.adjustCharge(service, { chargeId: bIn.id, propertyId, amount: 5, reason: 'late change', actorUserId: userId })).rejects.toThrow(/Only draft/);
    const { error } = await service.from('utility_charges').update({ total_amount: 1 }).eq('id', bIn.id);
    expect(error).not.toBeNull(); // DB trigger: approved charges are immutable
  }, 60_000);

  it('invoices as DRAFTS only: appends to an existing draft or creates a separate one', async () => {
    // A has an existing draft manual invoice due this month → utility lines are appended to it.
    const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const { data: draftId, error: draftError } = await session.rpc('create_manual_invoice', {
      p_org_id: orgId,
      p_lease_id: lease.A,
      p_tenant_id: tenant.A,
      p_invoice_date: new Date().toISOString().slice(0, 10),
      p_due_date: due,
      p_reference: 'OCT-RENT',
      p_description: 'October',
      p_notes: null,
      p_line_items: [{ description: 'Parking bay', quantity: 1, unitPrice: 350 }],
    });
    expect(draftError).toBeNull();
    const approvedIds = (await charges()).filter((c) => c.status === 'approved').map((c) => c.id);
    const result = await billing.invoiceCharges(session, service, { chargeIds: approvedIds, propertyId, actorUserId: userId });
    expect(result.modes).toEqual(expect.arrayContaining([{ invoiceId: draftId, mode: 'appended' }]));
    expect(result.modes).toHaveLength(2); // A (appended) + B2 (separate); B1 is disputed and still draft

    const { data: invA } = await service.from('invoices').select('status, amount, invoice_line_items(description, amount)').eq('id', draftId).single();
    expect(invA!.status).toBe('draft');
    expect(invA!.invoice_line_items).toHaveLength(3); // parking + water + shared electricity
    expect(Number(invA!.amount)).toBe(350 + 350 + 1890);
    const separate = result.modes.find((m) => m.mode === 'separate')!;
    const { data: invB } = await service.from('invoices').select('status, lease_id, amount').eq('id', separate.invoiceId).single();
    expect(invB).toMatchObject({ status: 'draft', lease_id: lease.B2 });
    expect(Number(invB!.amount)).toBe(675);

    // invoiced is final for the charge; a second invoice attempt finds nothing approved
    await expect(billing.invoiceCharges(session, service, { chargeIds: approvedIds, propertyId, actorUserId: userId })).rejects.toThrow(/approved/);
  }, 60_000);

  it('corrects an invoiced charge with a credit applied to the next period, never a negative line', async () => {
    const water = (await charges()).find((c) => c.unit_id === unit.A && c.utility_type === 'water' && c.period_start === '2026-09-01')!;
    expect(water.status).toBe('invoiced');
    await expect(billing.creditCharge(service, { chargeId: water.id, propertyId, amount: 999, reason: 'x too much', actorUserId: userId })).rejects.toThrow(/exceed/);
    await billing.creditCharge(service, { chargeId: water.id, propertyId, amount: 50, reason: 'Meter over-read confirmed', actorUserId: userId });

    const oct = await billing.generateCharges(service, { propertyId, periodStart: '2026-10-01', periodEnd: '2026-11-01', actorUserId: userId });
    expect(oct.created).toBeGreaterThanOrEqual(1);
    // October: 8 kL = 6 × R25 + 2 × R35 = R220.00 → less the R50.00 credit = R170.00
    const octWater = (await charges()).find((c) => c.unit_id === unit.A && c.utility_type === 'water' && c.period_start === '2026-10-01')!;
    expect(Number(octWater.credit_applied)).toBe(50);
    expect(Number(octWater.total_amount)).toBe(170);
    const { data: credit } = await service.from('utility_credits').select('remaining, status').eq('source_charge_id', water.id).single();
    expect(credit).toEqual({ remaining: 0, status: 'applied' });

    // Voiding the charge that consumed the credit gives the credit back for the next run.
    await billing.voidCharges(service, { chargeIds: [octWater.id], propertyId, actorUserId: userId });
    const { data: restored } = await service.from('utility_credits').select('remaining, status').eq('source_charge_id', water.id).single();
    expect(restored).toEqual({ remaining: 50, status: 'open' });
  }, 60_000);
});
