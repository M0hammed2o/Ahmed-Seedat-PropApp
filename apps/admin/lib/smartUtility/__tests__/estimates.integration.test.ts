import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Missing readings → opt-in ESTIMATE from the unit's recent actual use → TRUE-UP once readings arrive (migration 181).
// FICTIONAL tariff: flat R3,00/kWh incl. 15 % VAT + R60,00 fixed/month. Real local Supabase.
//   August (31 days): every unit used 310 kWh → 10 kWh/day.
//   September (30 days): no closing reading → estimate 300 kWh → R900 + R60 = R960.
//   Readings for 1 October arrive later:
//     A (estimate INVOICED)  actual 270 → overbilled R90  → a R90 utility credit.
//     B (estimate approved)  actual 330 → underbilled R90 → a draft R90 true-up charge (30 kWh).
//     C (estimate approved)  actual 280 → overbilled, not invoiced → skipped: void and recalculate.
//   D has no history: nothing to estimate from → refused, R0, never guessed.

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
delete process.env.RESEND_API_KEY;

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
const AUG = { periodStart: '2026-08-01', periodEnd: '2026-09-01' };
const SEP = { periodStart: '2026-09-01', periodEnd: '2026-10-01' };

d('estimates and true-up (real local Supabase)', () => {
  const sfx = Date.now();
  let orgId: string;
  let userId: string;
  let p: string;
  let session: SupabaseClient;
  const u: Record<string, string> = {};
  const m: Record<string, string> = {};

  const ins = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await service.from(table).insert(row).select('id').single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data!.id as string;
  };
  const read = async (meterId: string, y: number, mo: number, day: number, v: number) => {
    const { error } = await service.from('meter_telemetry_readings').insert({
      org_id: orgId, property_id: p, meter_id: meterId, read_at: sastInstant(y, mo, day).toISOString(), raw_value: v, multiplier: 1, value: v, source: 'device', status: 'valid',
    });
    if (error) throw new Error(error.message);
  };
  const charges = async () => (await service.from('utility_charges').select('*, units(unit_label)').eq('property_id', p).neq('status', 'void')).data ?? [];
  const sep = async (label: string, type = 'consumption') =>
    (await charges()).find((c) => c.units?.unit_label === label && c.charge_type === type && c.segment_start === '2026-09-01');

  beforeAll(async () => {
    const email = `est-${sfx}@propertyvault.example`;
    userId = (await service.auth.admin.createUser({ email, password: 'TestPassw0rd!23', email_confirm: true })).data.user!.id;
    orgId = await ins('organizations', { legal_name: `EST ${sfx}`, org_type: 'agency' });
    await service.from('organization_members').insert({ org_id: orgId, user_id: userId, role: 'accountant', status: 'active', joined_at: new Date().toISOString(), property_access_mode: 'all' });
    session = createClient(URL_, ANON_KEY, opts);
    await session.auth.signInWithPassword({ email, password: 'TestPassw0rd!23' });

    p = await ins('properties', { org_id: orgId, nickname: 'Estimate Court', address_line1: '3 Test St', city: 'Durban', province: 'KwaZulu-Natal', postal_code: '4001' });
    for (const k of ['A', 'B', 'C', 'D']) {
      u[k] = await ins('units', { org_id: orgId, property_id: p, unit_label: `Unit ${k}` });
      const tenantId = await ins('tenants', { org_id: orgId, full_name: `Tenant ${k}`, status: 'active' });
      const leaseId = await ins('leases', { org_id: orgId, unit_id: u[k], start_date: '2026-01-01', end_date: null, rent_amount: 5000, status: 'active' });
      await service.from('lease_tenants').insert({ lease_id: leaseId, tenant_id: tenantId, is_primary: true });
      m[k] = await ins('utility_meters', { org_id: orgId, property_id: p, unit_id: u[k], utility_type: 'electricity', meter_role: 'submeter', responsibility_mode: 'owner_paid' });
    }
    for (const k of ['A', 'B', 'C']) {
      await read(m[k]!, 2026, 8, 1, 0);
      await read(m[k]!, 2026, 9, 1, 310);
    }
    await read(m.D!, 2026, 9, 1, 0); // D: only an opening reading, no history
    await ins('utility_tariffs', { org_id: orgId, property_id: p, utility_type: 'electricity', name: 'FICTIONAL flat R3', tariff_kind: 'flat', fixed_charge: 60, blocks: [{ upTo: null, rate: 3 }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-01-01' });
    const { error } = await service.from('utility_billing_arrangements').insert(
      ['A', 'B', 'C', 'D'].map((k) => ({ org_id: orgId, property_id: p, unit_id: u[k], utility_type: 'electricity', arrangement: 'metered_recharge', effective_from: '2026-01-01', invoice_mode: 'separate_invoice' })),
    );
    if (error) throw new Error(error.message);
    await billing.generateCharges(service, { propertyId: p, ...AUG, actorUserId: userId });
  }, 120_000);

  it('August is billed from readings (independent: 310 × R3 + R60 = R990)', async () => {
    const aug = (await charges()).filter((c) => c.segment_start === '2026-08-01' && c.charge_type === 'consumption');
    expect(aug.map((c) => [c.units.unit_label, c.consumption === null ? null : Number(c.consumption), Number(c.total_amount)]).sort()).toEqual([
      ['Unit A', 310, 990],
      ['Unit B', 310, 990],
      ['Unit C', 310, 990],
      ['Unit D', null, 0], // no readings: recorded for review at R0, never guessed (estimates are opt-in)
    ]);
  });

  it('estimates nothing unless asked; when asked, 10 kWh/day × 30 = 300 kWh → R960, flagged', async () => {
    await billing.generateCharges(service, { propertyId: p, ...SEP, actorUserId: userId, estimateMissing: true });
    for (const k of ['A', 'B', 'C']) {
      const c = (await sep(`Unit ${k}`))!;
      expect(Number(c.consumption)).toBe(300);
      expect(Number(c.total_amount)).toBe(960);
      expect(c.review_flags).toContain('estimated_consumption_true_up_pending');
      expect(c.calculation.estimate).toMatchObject({ method: 'average_daily_from_recent_actuals', avgDaily: 10, days: 30, consumption: 300 });
      expect(c.notes).toMatch(/^Estimated: no usable readings; 10 per day from 1 earlier period/);
    }
    // D: no earlier actual use → never guessed; priced at nothing and left for review.
    const dCharge = (await sep('Unit D'))!;
    expect(dCharge.calculation.estimate).toBeUndefined();
    expect(Number(dCharge.total_amount)).toBe(0);
  }, 120_000);

  it('trues up once readings arrive: credit when an invoiced estimate was too high, draft charge when too low', async () => {
    const [a, b, c] = [(await sep('Unit A'))!, (await sep('Unit B'))!, (await sep('Unit C'))!];
    await billing.approveCharges(service, { chargeIds: [a.id, b.id, c.id], propertyId: p, actorUserId: userId });
    const inv = await billing.invoiceCharges(session, service, { chargeIds: [a.id], propertyId: p, actorUserId: userId });
    expect(inv.invoices).toHaveLength(1);
    // Nothing to true up before the readings exist.
    const before = await billing.generateCharges(service, { propertyId: p, ...SEP, actorUserId: userId });
    expect(before.created).toBe(0);

    await read(m.A!, 2026, 10, 1, 310 + 270);
    await read(m.B!, 2026, 10, 1, 310 + 330);
    await read(m.C!, 2026, 10, 1, 310 + 280);
    // Two runs race for the first true-up: between them exactly A's credit and B's true-up are created.
    const pair = await Promise.all([
      billing.generateCharges(service, { propertyId: p, ...SEP, actorUserId: userId }),
      billing.generateCharges(service, { propertyId: p, ...SEP, actorUserId: userId }),
    ]);
    expect(pair[0].created + pair[1].created).toBe(2);
    const r = pair[0];

    // A: 270 × 3 + 60 = 870 vs 960 → R90 credit on the invoiced estimate.
    const { data: credits } = await service.from('utility_credits').select('amount, remaining, reason, lease_id').eq('source_charge_id', a.id);
    expect(credits).toHaveLength(1);
    expect(Number(credits![0]!.amount)).toBe(90);
    expect(credits![0]!.reason).toMatch(/^True-up: actual 270 vs estimated 300 for 2026-09-01 to 2026-09-30/);
    expect(credits![0]!.lease_id).toBe(a.lease_id);

    // B: 330 × 3 + 60 = 1050 vs 960 → a DRAFT R90 true-up for 30 kWh; VAT split adds back to the total.
    const t = (await sep('Unit B', 'true_up'))!;
    expect(t).toMatchObject({ status: 'draft', segment_end: '2026-10-01' });
    expect(Number(t.consumption)).toBe(30);
    expect(Number(t.total_amount)).toBe(90);
    expect(Math.round((Number(t.amount_excl_vat) + Number(t.vat_amount)) * 100)).toBe(9000);
    expect(Number(t.amount_excl_vat)).toBeCloseTo(90 / 1.15, 2);
    expect(t.review_flags).toContain('true_up_of_estimate');
    expect(t.calculation).toMatchObject({ kind: 'true_up', estimateChargeId: b.id, estimated: 300, actual: 330, estimatedCents: 96000, actualCents: 105000 });

    // C: overbilled but only approved → no credit, told to void and recalculate.
    expect(r.skipped.find((s) => s.unitId === u.C)?.reason).toMatch(/void it and recalculate/);
    expect((await service.from('utility_credits').select('id').eq('source_charge_id', c.id)).data).toHaveLength(0);
  }, 120_000);

  it('never trues up twice (re-runs, including concurrent ones)', async () => {
    const runs = await Promise.all([
      billing.generateCharges(service, { propertyId: p, ...SEP, actorUserId: userId }),
      billing.generateCharges(service, { propertyId: p, ...SEP, actorUserId: userId }),
    ]);
    expect(runs.map((x) => x.created)).toEqual([0, 0]);
    expect((await charges()).filter((c) => c.charge_type === 'true_up')).toHaveLength(1);
    const a = (await sep('Unit A'))!;
    expect((await service.from('utility_credits').select('id').eq('source_charge_id', a.id)).data).toHaveLength(1);
  }, 120_000);

  it('TD-61: a VAT-registered landlord sees that utility VAT is not yet split in the ledger', async () => {
    await service.from('organizations').update({ vat_no: '4000000000' }).eq('id', orgId); // fictional
    const unitE = await ins('units', { org_id: orgId, property_id: p, unit_label: 'Unit E' });
    const tenantId = await ins('tenants', { org_id: orgId, full_name: 'Tenant E', status: 'active' });
    const leaseId = await ins('leases', { org_id: orgId, unit_id: unitE, start_date: '2026-01-01', end_date: null, rent_amount: 5000, status: 'active' });
    await service.from('lease_tenants').insert({ lease_id: leaseId, tenant_id: tenantId, is_primary: true });
    const meterE = await ins('utility_meters', { org_id: orgId, property_id: p, unit_id: unitE, utility_type: 'electricity', meter_role: 'submeter', responsibility_mode: 'owner_paid' });
    await read(meterE, 2026, 10, 1, 0);
    await read(meterE, 2026, 11, 1, 100);
    await ins('utility_billing_arrangements', { org_id: orgId, property_id: p, unit_id: unitE, utility_type: 'electricity', arrangement: 'metered_recharge', effective_from: '2026-01-01', invoice_mode: 'separate_invoice' });
    await billing.generateCharges(service, { propertyId: p, periodStart: '2026-10-01', periodEnd: '2026-11-01', actorUserId: userId });
    const e = (await charges()).find((c) => c.units?.unit_label === 'Unit E' && c.segment_start === '2026-10-01')!;
    expect(Number(e.total_amount)).toBe(360); // 100 × 3 + 60
    expect(e.review_flags).toContain('vat_ledger_split_pending');
    await service.from('organizations').update({ vat_no: null }).eq('id', orgId);
  }, 120_000);
});
