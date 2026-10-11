import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Financial validation against independently computed results (docs/UTILITIES_FINANCIAL_VALIDATION.md).
// ALL TARIFFS ARE FICTIONAL TEST FIGURES — not municipal or legally authorised rates. Real local Supabase.
//
// Scenario A — "Jacaranda Court", Pretoria: six flats, solar PV + battery + grid, borehole + municipal water.
//   Electricity: flat R3,00/kWh incl. VAT + R60,00 fixed/month. Water: blocks 0–6 kL R20, 6–15 R30, >15 R50.
//   Flat 3 has two electricity submeters (geyser 80 + plugs 40 kWh) → ONE supply, ONE fixed charge.
//   Flat 5: tenant out 15 Oct (inclusive), new tenant in 16 Oct. Flat 6: vacant, plus a unit-linked CHECK meter.
//   Flats 1–4 share a water meter split by floor area (40/50/60/70 m²), landlord keeps 10 % (common areas).
//   Solar generation, battery, grid import, borehole supply and borehole pump meters exist and must never bill.
// Scenario B — audit defects: arrangement change mid-period, meter replacement re-run, terminated lease without end
//   date, credit/adjustment VAT, invoice void releasing charges, concurrent invoicing, mid-month tariff change,
//   time-of-use + allowance refusal, appending to a draft in a 30-day month.

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
const PERIOD = { periodStart: '2026-10-01', periodEnd: '2026-11-01' }; // 31 days

d('financial validation (real local Supabase)', () => {
  const sfx = Date.now();
  let orgId: string;
  let userId: string;
  let session: SupabaseClient;

  const ins = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await service.from(table).insert(row).select('id').single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data!.id as string;
  };
  const reading = (orgIdArg: string, propertyId: string, meterId: string, y: number, m: number, day: number, raw: number) => ({
    org_id: orgIdArg, property_id: propertyId, meter_id: meterId, read_at: sastInstant(y, m, day).toISOString(), raw_value: raw, multiplier: 1, value: raw, source: 'device',
  });
  const tenantLease = async (unitId: string, start: string, end: string | null, status: string, name: string) => {
    const tenantId = await ins('tenants', { org_id: orgId, full_name: name, status: 'active' });
    const leaseId = await ins('leases', { org_id: orgId, unit_id: unitId, start_date: start, end_date: end, rent_amount: 6000, status });
    await service.from('lease_tenants').insert({ lease_id: leaseId, tenant_id: tenantId, is_primary: true });
    return { tenantId, leaseId };
  };
  const charges = async (propertyId: string) => (await service.from('utility_charges').select('*, units(unit_label)').eq('property_id', propertyId).neq('status', 'void')).data ?? [];

  beforeAll(async () => {
    const email = `fin-${sfx}@propertyvault.example`;
    userId = (await service.auth.admin.createUser({ email, password: 'TestPassw0rd!23', email_confirm: true })).data.user!.id;
    orgId = await ins('organizations', { legal_name: `FIN ${sfx}`, org_type: 'agency' });
    await service.from('organization_members').insert({ org_id: orgId, user_id: userId, role: 'accountant', status: 'active', joined_at: new Date().toISOString(), property_access_mode: 'all' });
    session = createClient(URL_, ANON_KEY, opts);
    await session.auth.signInWithPassword({ email, password: 'TestPassw0rd!23' });
  }, 60_000);

  describe('Scenario A — six flats, solar + borehole', () => {
    let p: string;
    const u: Record<string, string> = {};
    const nonBillable: string[] = [];
    let sharedWater: string;

    beforeAll(async () => {
      p = await ins('properties', { org_id: orgId, nickname: 'Jacaranda Court', address_line1: '7 Jacaranda Ave', city: 'Pretoria', province: 'Gauteng', postal_code: '0181' });
      const sizes = [40, 50, 60, 70, 45, 55];
      for (let i = 1; i <= 6; i++) u[`F${i}`] = await ins('units', { org_id: orgId, property_id: p, unit_label: `Flat ${i}`, size_sqm: sizes[i - 1] });
      for (const f of ['F1', 'F2', 'F3', 'F4']) await tenantLease(u[f]!, '2026-01-01', null, 'active', `Tenant ${f}`);
      await tenantLease(u.F5!, '2025-06-01', '2026-10-15', 'terminated', 'Tenant F5 out');
      await tenantLease(u.F5!, '2026-10-16', null, 'active', 'Tenant F5 in');

      const src = async (utility: string, type: string, name: string) => ins('utility_supply_sources', { org_id: orgId, property_id: p, utility_type: utility, source_type: type, name });
      const pv = await src('electricity', 'solar_pv', 'Roof PV');
      const bat = await src('electricity', 'battery', 'Battery');
      const grid = await src('electricity', 'municipal_grid', 'Grid');
      const bh = await src('water', 'borehole', 'Borehole');
      const muni = await src('water', 'municipal', 'Municipal water');
      const meter = async (row: Record<string, unknown>, from: number, mid: number | null, to: number) => {
        const id = await ins('utility_meters', { org_id: orgId, property_id: p, responsibility_mode: 'owner_paid', ...row });
        const rs = [reading(orgId, p, id, 2026, 10, 1, from), reading(orgId, p, id, 2026, 11, 1, to)];
        if (mid !== null) rs.push(reading(orgId, p, id, 2026, 10, 16, mid));
        const { error } = await service.from('meter_telemetry_readings').insert(rs);
        if (error) throw new Error(error.message);
        return id;
      };
      // Billable consumption submeters (kWh / litres)
      await meter({ unit_id: u.F1, utility_type: 'electricity', meter_role: 'submeter' }, 0, null, 100);
      await meter({ unit_id: u.F2, utility_type: 'electricity', meter_role: 'submeter' }, 0, null, 150);
      await meter({ unit_id: u.F3, utility_type: 'electricity', meter_role: 'submeter', location: 'geyser' }, 0, null, 80);
      await meter({ unit_id: u.F3, utility_type: 'electricity', meter_role: 'submeter', location: 'plugs' }, 0, null, 40);
      await meter({ unit_id: u.F4, utility_type: 'electricity', meter_role: 'submeter' }, 0, null, 200);
      await meter({ unit_id: u.F5, utility_type: 'electricity', meter_role: 'submeter' }, 0, 50, 90);
      await meter({ unit_id: u.F6, utility_type: 'electricity', meter_role: 'submeter' }, 0, null, 30);
      // Never billable
      nonBillable.push(await meter({ unit_id: u.F6, utility_type: 'electricity', meter_role: 'check' }, 0, null, 999));
      nonBillable.push(await meter({ utility_type: 'electricity', meter_role: 'main', measurement_kind: 'grid_import', supply_source_id: grid }, 0, null, 500));
      nonBillable.push(await meter({ utility_type: 'electricity', meter_role: 'check', measurement_kind: 'generation', supply_source_id: pv }, 0, null, 700));
      nonBillable.push(await meter({ utility_type: 'electricity', meter_role: 'check', measurement_kind: 'battery_discharge', supply_source_id: bat }, 0, null, 120));
      nonBillable.push(await meter({ utility_type: 'electricity', meter_role: 'check', measurement_kind: 'pump_energy', supply_source_id: bh }, 0, null, 90));
      nonBillable.push(await meter({ utility_type: 'water', meter_role: 'check', measurement_kind: 'source_supply', supply_source_id: bh }, 0, null, 30_000));
      nonBillable.push(await meter({ utility_type: 'water', meter_role: 'check', measurement_kind: 'source_supply', supply_source_id: muni }, 0, null, 25_000));
      // Shared water meter for flats 1–4: 40 kL
      sharedWater = await meter({ utility_type: 'water', meter_role: 'check', location: 'Block A shared' }, 0, null, 40_000);

      await service.from('utility_tariffs').insert([
        { org_id: orgId, property_id: p, utility_type: 'electricity', name: 'FICTIONAL flat R3', tariff_kind: 'flat', fixed_charge: 60, blocks: [{ upTo: null, rate: 3 }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-01-01' },
        { org_id: orgId, property_id: p, utility_type: 'water', name: 'FICTIONAL water blocks', tariff_kind: 'block', fixed_charge: 0, blocks: [{ upTo: 6, rate: 20 }, { upTo: 15, rate: 30 }, { upTo: null, rate: 50 }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-01-01' },
      ]);
      const group = await ins('utility_allocation_groups', { org_id: orgId, property_id: p, meter_id: sharedWater, name: 'Block A water', method: 'floor_area', landlord_share_pct: 10 });
      await service.from('utility_allocation_members').insert(['F1', 'F2', 'F3', 'F4'].map((f) => ({ group_id: group, org_id: orgId, property_id: p, unit_id: u[f] })));
      const arr = (unit: string, utility: string, arrangement: string, extra: Record<string, unknown> = {}) => ({
        org_id: orgId, property_id: p, unit_id: unit, utility_type: utility, arrangement, effective_from: '2026-01-01', invoice_mode: 'separate_invoice', allocation_group_id: null, ...extra,
      });
      const { error } = await service.from('utility_billing_arrangements').insert([
        ...['F1', 'F2', 'F3', 'F4', 'F5', 'F6'].map((f) => arr(u[f]!, 'electricity', 'metered_recharge')),
        ...['F1', 'F2', 'F3', 'F4'].map((f) => arr(u[f]!, 'water', 'shared_allocation', { allocation_group_id: group })),
        arr(u.F5!, 'water', 'landlord_paid'),
      ]);
      if (error) throw new Error(error.message);
    }, 120_000);

    it('bills exactly the independently computed amounts', async () => {
      const r = await billing.generateCharges(service, { propertyId: p, ...PERIOD, actorUserId: userId });
      expect(r.created).toBe(10); // electricity F1–F4 (4) + F5 two tenants (2) + water shares F1–F4 (4)
      const all = await charges(p);
      const by = (label: string, utility: string) => all.filter((c) => c.units?.unit_label === label && c.utility_type === utility).map((c) => Number(c.total_amount)).sort((a, b) => a - b);
      // Electricity: kWh × R3,00 + R60,00 fixed (prorated by days for the move-out/move-in)
      expect(by('Flat 1', 'electricity')).toEqual([360]); // 100×3 + 60
      expect(by('Flat 2', 'electricity')).toEqual([510]); // 150×3 + 60
      expect(by('Flat 3', 'electricity')).toEqual([420]); // (80+40)×3 + ONE fixed 60
      expect(by('Flat 4', 'electricity')).toEqual([660]); // 200×3 + 60
      expect(by('Flat 5', 'electricity')).toEqual([150.97, 179.03]); // 40×3 + 60×16/31 (30,97); 50×3 + 60×15/31 (29,03)
      expect(by('Flat 6', 'electricity')).toEqual([]); // vacant; its check meter is never billed
      // Water: 40 kL = 6×20 + 9×30 + 25×50 = R1 640,00; landlord keeps 10 % → R1 476,00 by floor area 40:50:60:70,
      // largest-remainder cents: 268,36 + 335,45 + 402,55 + 469,64 = 1 476,00
      expect(by('Flat 1', 'water')).toEqual([268.36]);
      expect(by('Flat 2', 'water')).toEqual([335.45]);
      expect(by('Flat 3', 'water')).toEqual([402.55]);
      expect(by('Flat 4', 'water')).toEqual([469.64]);
      expect(Math.round(['Flat 1', 'Flat 2', 'Flat 3', 'Flat 4'].reduce((a, f) => a + by(f, 'water')[0]!, 0) * 100)).toBe(147600);
      // VAT inside R360,00 incl. at 15 %: per-line half-up (usage R300 → 39,13; fixed R60 → 7,83) = 46,96
      const f1 = all.find((c) => c.units?.unit_label === 'Flat 1' && c.utility_type === 'electricity')!;
      expect(Number(f1.vat_amount)).toBe(46.96);
      expect(Math.round((Number(f1.amount_excl_vat) + Number(f1.vat_amount)) * 100)).toBe(36000);
      // Every charge cites only a consumption submeter or the shared consumption meter — never a hybrid register
      for (const c of all) expect(nonBillable).not.toContain(c.meter_id);
      // Flat 5's two segments go to the two different tenants
      expect(new Set(all.filter((c) => c.units?.unit_label === 'Flat 5').map((c) => c.lease_id)).size).toBe(2);
      // Regulatory flags present on every charge
      for (const c of all) expect((c.review_flags as string[]).some((f) => f.endsWith('_review'))).toBe(true);
      // Skips are explained
      expect(r.skipped.some((s) => s.unitId === u.F6 && /vacant/i.test(s.reason))).toBe(true);
    }, 120_000);

    it('a second run (and a concurrent one) creates nothing new', async () => {
      const [a, b] = await Promise.all([
        billing.generateCharges(service, { propertyId: p, ...PERIOD, actorUserId: userId }),
        billing.generateCharges(service, { propertyId: p, ...PERIOD, actorUserId: userId }),
      ]);
      expect(a.created + b.created).toBe(0);
      expect(await charges(p)).toHaveLength(10);
    }, 120_000);

    it('approval + invoicing: drafts only, usage and fixed charge as separate lines, never twice', async () => {
      const all = await charges(p);
      await billing.approveCharges(service, { chargeIds: all.map((c) => c.id), propertyId: p, actorUserId: userId });
      const f2 = all.find((c) => c.units?.unit_label === 'Flat 2' && c.utility_type === 'electricity')!;
      // Two concurrent invoice requests for the same charge: exactly one invoice gets it.
      const results = await Promise.allSettled([
        billing.invoiceCharges(session, service, { chargeIds: [f2.id], propertyId: p, actorUserId: userId }),
        billing.invoiceCharges(session, service, { chargeIds: [f2.id], propertyId: p, actorUserId: userId }),
      ]);
      const invoiceIds = results.flatMap((r) => (r.status === 'fulfilled' ? r.value.invoices : []));
      expect(invoiceIds).toHaveLength(1);
      const { data: inv } = await service.from('invoices').select('status, issued_at, invoice_line_items(description, amount)').eq('id', invoiceIds[0]).single();
      expect(inv).toMatchObject({ status: 'draft', issued_at: null });
      expect((inv!.invoice_line_items as { amount: number }[]).map((l) => Number(l.amount)).sort((a, b) => a - b)).toEqual([60, 450]);
      const { count } = await service.from('invoice_line_items').select('id', { count: 'exact', head: true }).in('invoice_id', invoiceIds);
      expect(count).toBe(2);
    }, 120_000);

    it('voiding the invoice releases the charge so it can be corrected and invoiced again', async () => {
      const f2 = (await charges(p)).find((c) => c.units?.unit_label === 'Flat 2' && c.utility_type === 'electricity')!;
      expect(f2.status).toBe('invoiced');
      const { error } = await session.rpc('void_invoice', { p_invoice_id: f2.invoice_id, p_reason: 'Audit test: wrong period' });
      expect(error).toBeNull();
      const { data: after } = await service.from('utility_charges').select('status, invoice_id').eq('id', f2.id).single();
      expect(after).toEqual({ status: 'approved', invoice_id: null });
      const again = await billing.invoiceCharges(session, service, { chargeIds: [f2.id], propertyId: p, actorUserId: userId });
      expect(again.invoices).toHaveLength(1);
    }, 120_000);
  });

  describe('Scenario B — audit defects stay fixed', () => {
    let p: string;
    const u: Record<string, string> = {};
    const meters: Record<string, string> = {};

    beforeAll(async () => {
      p = await ins('properties', { org_id: orgId, nickname: 'Audit Flats', address_line1: '9 Audit Rd', city: 'Durban', province: 'KwaZulu-Natal', postal_code: '4001' });
      for (const k of ['U1', 'U2', 'U3', 'U4']) u[k] = await ins('units', { org_id: orgId, property_id: p, unit_label: k });
      await tenantLease(u.U1!, '2026-01-01', null, 'active', 'U1 tenant');
      await tenantLease(u.U2!, '2026-01-01', null, 'active', 'U2 tenant');
      await tenantLease(u.U3!, '2025-01-01', null, 'terminated', 'U3 old (no end date)');
      await tenantLease(u.U3!, '2026-10-15', null, 'active', 'U3 new');
      await tenantLease(u.U4!, '2026-01-01', null, 'active', 'U4 tenant');
      const m = async (unit: string, pts: [number, number, number][]) => {
        const id = await ins('utility_meters', { org_id: orgId, property_id: p, unit_id: unit, utility_type: 'electricity', responsibility_mode: 'owner_paid', meter_role: 'submeter' });
        await service.from('meter_telemetry_readings').insert(pts.map(([mo, day, v]) => reading(orgId, p, id, 2026, mo, day, v)));
        return id;
      };
      meters.U1 = await m(u.U1!, [[10, 1, 0], [10, 16, 100], [11, 1, 300]]);
      meters.U2 = await m(u.U2!, [[10, 1, 0], [11, 1, 200]]);
      meters.U3 = await m(u.U3!, [[10, 1, 0], [11, 1, 50]]);
      meters.U4 = await m(u.U4!, [[10, 1, 0], [11, 1, 100]]);
      await service.from('utility_tariffs').insert({ org_id: orgId, property_id: p, utility_type: 'electricity', name: 'FICTIONAL flat R3 (no fixed)', tariff_kind: 'flat', fixed_charge: 0, blocks: [{ upTo: null, rate: 3 }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-01-01' });
      const arr = (unit: string, from: string, to: string | null, mode = 'separate_invoice', extra: Record<string, unknown> = {}) => ({
        org_id: orgId, property_id: p, unit_id: unit, utility_type: 'electricity', arrangement: 'metered_recharge', effective_from: from, effective_to: to, invoice_mode: mode, allocation_group_id: null, fixed_amount: null, allowance_quantity: null, ...extra,
      });
      const { error } = await service.from('utility_billing_arrangements').insert([
        // U1: arrangement changed on 16 Oct (invoice mode only) — must NOT double-bill
        arr(u.U1!, '2026-01-01', '2026-10-15'),
        arr(u.U1!, '2026-10-16', null, 'with_draft_invoice'),
        arr(u.U2!, '2026-01-01', null),
        arr(u.U3!, '2026-01-01', null),
        arr(u.U4!, '2026-01-01', null, 'with_draft_invoice'),
      ]);
      if (error) throw new Error(error.message);
      await billing.generateCharges(service, { propertyId: p, ...PERIOD, actorUserId: userId });
    }, 120_000);

    it('arrangement change mid-period: two segments summing to one month (R900, not R1 800)', async () => {
      const c = (await charges(p)).filter((x) => x.unit_id === u.U1).sort((a, b) => String(a.segment_start).localeCompare(String(b.segment_start)));
      expect(c.map((x) => [x.segment_start, x.segment_end, Number(x.consumption), Number(x.total_amount)])).toEqual([
        ['2026-10-01', '2026-10-16', 100, 300],
        ['2026-10-16', '2026-11-01', 200, 600],
      ]);
    });

    it('terminated lease without an end date is refused, not billed', async () => {
      expect((await charges(p)).filter((x) => x.unit_id === u.U3)).toEqual([]);
      const r = await billing.generateCharges(service, { propertyId: p, ...PERIOD, actorUserId: userId });
      expect(r.skipped.some((s) => s.unitId === u.U3 && /no end date/.test(s.reason))).toBe(true);
    });

    it('re-running after a meter replacement does not bill the old consumption again', async () => {
      await service.from('utility_meters').update({ active: false, decommissioned_at: new Date().toISOString() }).eq('id', meters.U2);
      const b = await ins('utility_meters', { org_id: orgId, property_id: p, unit_id: u.U2, utility_type: 'electricity', responsibility_mode: 'owner_paid', meter_role: 'submeter', replaced_meter_id: meters.U2 });
      await service.from('meter_telemetry_readings').insert(reading(orgId, p, b, 2026, 11, 1, 0));
      const r = await billing.generateCharges(service, { propertyId: p, ...PERIOD, actorUserId: userId });
      expect(r.created).toBe(0);
      const u2 = (await charges(p)).filter((x) => x.unit_id === u.U2);
      expect(u2.map((x) => Number(x.total_amount))).toEqual([600]);
    });

    it('adjustments and credits keep VAT consistent with the new total', async () => {
      const seg1 = (await charges(p)).find((x) => x.unit_id === u.U1 && x.segment_start === '2026-10-01')!;
      // R300,00 incl. 15 % → VAT 39,13; adjusted −R100 → R200,00: VAT 39,13 × 200/300 = 26,0867 → 26,09; excl 173,91
      await billing.adjustCharge(service, { chargeId: seg1.id, propertyId: p, amount: -100, reason: 'Audit test adjustment', actorUserId: userId });
      const { data: a } = await service.from('utility_charges').select('total_amount, amount_excl_vat, vat_amount').eq('id', seg1.id).single();
      expect([Number(a!.total_amount), Number(a!.amount_excl_vat), Number(a!.vat_amount)]).toEqual([200, 173.91, 26.09]);
    });

    it('appending to an existing draft works when the due month has 30 days', async () => {
      const today = new Date();
      let days = 1;
      for (; days < 70; days++) {
        const due = new Date(today.getTime() + days * 86_400_000);
        const dim = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate();
        if (dim < 31) break;
      }
      const due = new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10);
      const u4 = (await charges(p)).find((x) => x.unit_id === u.U4)!;
      const leaseId = u4.lease_id as string;
      const { data: draftId, error } = await session.rpc('create_manual_invoice', {
        p_org_id: orgId, p_lease_id: leaseId, p_tenant_id: u4.tenant_id, p_invoice_date: today.toISOString().slice(0, 10), p_due_date: due,
        p_reference: 'RENT', p_description: 'Rent', p_notes: null, p_line_items: [{ description: 'Rent', quantity: 1, unitPrice: 6000 }],
      });
      expect(error).toBeNull();
      await billing.approveCharges(service, { chargeIds: [u4.id], propertyId: p, actorUserId: userId });
      const res = await billing.invoiceCharges(session, service, { chargeIds: [u4.id], propertyId: p, actorUserId: userId, dueInDays: days });
      expect(res.modes).toEqual([{ invoiceId: draftId, mode: 'appended' }]);
    });
  });

  describe('Scenario D — percentage and occupancy shared meters', () => {
    const setup = async (name: string, utility: string, method: string, landlordPct: number, members: { pct?: number; occ?: number }[], meterRaw: number, rate: number) => {
      const p = await ins('properties', { org_id: orgId, nickname: name, address_line1: '3 Split St', city: 'Gqeberha', province: 'Eastern Cape', postal_code: '6001' });
      const units: string[] = [];
      for (let i = 0; i < members.length; i++) {
        const unit = await ins('units', { org_id: orgId, property_id: p, unit_label: `S${i + 1}` });
        await tenantLease(unit, '2026-01-01', null, 'active', `${name} T${i + 1}`);
        units.push(unit);
      }
      const meter = await ins('utility_meters', { org_id: orgId, property_id: p, utility_type: utility, responsibility_mode: 'owner_paid', meter_role: 'check' });
      await service.from('meter_telemetry_readings').insert([reading(orgId, p, meter, 2026, 10, 1, 0), reading(orgId, p, meter, 2026, 11, 1, meterRaw)]);
      await service.from('utility_tariffs').insert({ org_id: orgId, property_id: p, utility_type: utility, name: `FICTIONAL ${rate}`, tariff_kind: 'flat', fixed_charge: 0, blocks: [{ upTo: null, rate }], effective_from: '2026-01-01' });
      const group = await ins('utility_allocation_groups', { org_id: orgId, property_id: p, meter_id: meter, name: `${name} group`, method, landlord_share_pct: landlordPct });
      await service.from('utility_allocation_members').insert(members.map((m, i) => ({ group_id: group, org_id: orgId, property_id: p, unit_id: units[i], percentage: m.pct ?? null, occupants: m.occ ?? null })));
      await service.from('utility_billing_arrangements').insert(units.map((unit) => ({ org_id: orgId, property_id: p, unit_id: unit, utility_type: utility, arrangement: 'shared_allocation', allocation_group_id: group, effective_from: '2026-01-01' })));
      await billing.generateCharges(service, { propertyId: p, ...PERIOD, actorUserId: userId });
      const c = await charges(p);
      return units.map((unit) => c.filter((x) => x.unit_id === unit).map((x) => Number(x.total_amount)));
    };

    it('percentage: 30 % / 50 % / landlord 20 % of R200,00 → R60,00 and R100,00 (landlord R40,00 not charged)', async () => {
      // 10 kL × R20 = R200,00
      expect(await setup('Pct Court', 'water', 'percentage', 20, [{ pct: 30 }, { pct: 50 }], 10_000, 20)).toEqual([[60], [100]]);
    }, 120_000);

    it('occupancy: 2 / 3 / 5 occupants of R30,00 → R6,00 / R9,00 / R15,00', async () => {
      // 10 kWh × R3 = R30,00, no landlord share
      expect(await setup('Occ Court', 'electricity', 'occupancy', 0, [{ occ: 2 }, { occ: 3 }, { occ: 5 }], 10, 3)).toEqual([[6], [9], [15]]);
    }, 120_000);

    it('equal split with a vacant member: R100,00 three ways → R33,34 + R33,33 charged; the vacant third stays with the landlord', async () => {
      const p = await ins('properties', { org_id: orgId, nickname: 'Equal Court', address_line1: '4 Split St', city: 'Gqeberha', province: 'Eastern Cape', postal_code: '6001' });
      const units: string[] = [];
      for (let i = 0; i < 3; i++) units.push(await ins('units', { org_id: orgId, property_id: p, unit_label: `E${i + 1}` }));
      await tenantLease(units[0]!, '2026-01-01', null, 'active', 'E1');
      await tenantLease(units[1]!, '2026-01-01', null, 'active', 'E2');
      const meter = await ins('utility_meters', { org_id: orgId, property_id: p, utility_type: 'electricity', responsibility_mode: 'owner_paid', meter_role: 'check' });
      await service.from('meter_telemetry_readings').insert([reading(orgId, p, meter, 2026, 10, 1, 0), reading(orgId, p, meter, 2026, 11, 1, 50)]);
      await service.from('utility_tariffs').insert({ org_id: orgId, property_id: p, utility_type: 'electricity', name: 'FICTIONAL R2', tariff_kind: 'flat', fixed_charge: 0, blocks: [{ upTo: null, rate: 2 }], effective_from: '2026-01-01' });
      const group = await ins('utility_allocation_groups', { org_id: orgId, property_id: p, meter_id: meter, name: 'Equal group', method: 'equal', landlord_share_pct: 0 });
      await service.from('utility_allocation_members').insert(units.map((unit) => ({ group_id: group, org_id: orgId, property_id: p, unit_id: unit })));
      await service.from('utility_billing_arrangements').insert(units.map((unit) => ({ org_id: orgId, property_id: p, unit_id: unit, utility_type: 'electricity', arrangement: 'shared_allocation', allocation_group_id: group, effective_from: '2026-01-01' })));
      await billing.generateCharges(service, { propertyId: p, ...PERIOD, actorUserId: userId });
      const c = await charges(p);
      // 50 kWh × R2 = R100,00 = 10 000 c; thirds by largest remainder: 3 334 / 3 333 / 3 333
      expect(units.map((unit) => c.filter((x) => x.unit_id === unit).map((x) => Number(x.total_amount)))).toEqual([[33.34], [33.33], []]);
    }, 120_000);
  });

  describe('Scenario C — tariff change inside the period; TOU with an allowance', () => {
    it('15 Jun – 15 Jul across the 1 July increase: 10 kL at R30 + 10 kL at R33 = R630,00 (not R600)', async () => {
      const p = await ins('properties', { org_id: orgId, nickname: 'Tariff Year', address_line1: '1 July St', city: 'Cape Town', province: 'Western Cape', postal_code: '8001' });
      const unit = await ins('units', { org_id: orgId, property_id: p, unit_label: 'Flat 1' });
      await tenantLease(unit, '2026-01-01', null, 'active', 'Water tenant');
      const m = await ins('utility_meters', { org_id: orgId, property_id: p, unit_id: unit, utility_type: 'water', responsibility_mode: 'owner_paid', meter_role: 'submeter' });
      await service.from('meter_telemetry_readings').insert([reading(orgId, p, m, 2026, 6, 15, 0), reading(orgId, p, m, 2026, 7, 1, 10_000), reading(orgId, p, m, 2026, 7, 15, 20_000)]);
      await service.from('utility_tariffs').insert([
        { org_id: orgId, property_id: p, utility_type: 'water', name: 'FICTIONAL 2025/26', tariff_kind: 'flat', fixed_charge: 0, blocks: [{ upTo: null, rate: 30 }], effective_from: '2025-07-01', effective_to: '2026-06-30' },
        { org_id: orgId, property_id: p, utility_type: 'water', name: 'FICTIONAL 2026/27', tariff_kind: 'flat', fixed_charge: 0, blocks: [{ upTo: null, rate: 33 }], effective_from: '2026-07-01' },
      ]);
      await service.from('utility_billing_arrangements').insert({ org_id: orgId, property_id: p, unit_id: unit, utility_type: 'water', arrangement: 'metered_recharge', effective_from: '2026-01-01' });
      await billing.generateCharges(service, { propertyId: p, periodStart: '2026-06-15', periodEnd: '2026-07-15', actorUserId: userId });
      const c = (await charges(p)).sort((a, b) => String(a.segment_start).localeCompare(String(b.segment_start)));
      expect(c.map((x) => [x.segment_start, Number(x.consumption), Number(x.total_amount)])).toEqual([
        ['2026-06-15', 10, 300],
        ['2026-07-01', 10, 330],
      ]);
    }, 120_000);

    it('a time-of-use tariff with an included allowance is refused instead of billing all usage', async () => {
      const p = await ins('properties', { org_id: orgId, nickname: 'TOU Allowance', address_line1: '2 TOU Rd', city: 'Durban', province: 'KwaZulu-Natal', postal_code: '4001' });
      const unit = await ins('units', { org_id: orgId, property_id: p, unit_label: 'Flat 1' });
      await tenantLease(unit, '2026-01-01', null, 'active', 'TOU tenant');
      const m = await ins('utility_meters', { org_id: orgId, property_id: p, unit_id: unit, utility_type: 'electricity', responsibility_mode: 'owner_paid', meter_role: 'submeter' });
      await service.from('meter_telemetry_readings').insert([reading(orgId, p, m, 2026, 10, 1, 0), reading(orgId, p, m, 2026, 11, 1, 100)]);
      const all = [{ days: 'all', from: '00:00', to: '00:00' }];
      await service.from('utility_tariffs').insert({ org_id: orgId, property_id: p, utility_type: 'electricity', name: 'FICTIONAL TOU', tariff_kind: 'tou', fixed_charge: 0, blocks: [], tou_periods: [{ name: 'Any', rate: 2, windows: all }], effective_from: '2026-01-01' });
      await service.from('utility_billing_arrangements').insert({ org_id: orgId, property_id: p, unit_id: unit, utility_type: 'electricity', arrangement: 'fixed_allowance', fixed_amount: 100, allowance_quantity: 50, effective_from: '2026-01-01' });
      await billing.generateCharges(service, { propertyId: p, ...PERIOD, actorUserId: userId });
      const c = await charges(p);
      const excess = c.find((x) => x.charge_type === 'excess')!;
      expect(Number(excess.total_amount)).toBe(0);
      expect(excess.notes).toMatch(/cannot be combined with an included allowance/);
      // and it cannot be approved
      await expect(billing.approveCharges(service, { chargeIds: [excess.id], propertyId: p, actorUserId: userId })).rejects.toThrow();
    }, 120_000);
  });
});
