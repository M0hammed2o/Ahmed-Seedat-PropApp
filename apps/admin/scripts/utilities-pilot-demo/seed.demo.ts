import { deflateSync, crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ============================================================================================================
// Smart Utilities PILOT DEMONSTRATION DATA — reusable, FICTIONAL, DISPOSABLE DATABASES ONLY.
//
//   Run:  PILOT_DEMO_CONFIRM=disposable PILOT_DEMO_PASSWORD=<choose one> \
//         npx vitest run -c vitest.demo.config.ts        (from apps/admin, against the LOCAL Supabase stack)
//
// Every run creates a NEW demo organisation (nothing is updated or deleted), so it is safe to repeat. It refuses to
// run unless: the Supabase URL is the local stack, PILOT_DEMO_CONFIRM=disposable is set, and the database holds fewer
// than 200 organisations (the preserved main local copy has thousands; a customer database is never local).
//
// What it builds — "DEMO Protea Gardens", Pietermaritzburg (fictional), 7 residential flats, October 2026:
//   • Municipal grid + rooftop solar (monitoring only), municipal water + borehole + JoJo tank (monitoring only)
//   • Main meters and unit submeters (main → submeter relationships), a shared water meter
//   • Arrangements: metered, included in rent, landlord pays, fixed with allowance, fixed only, shared split,
//     move-out/move-in, and a vacant flat that is monitored only (no arrangement, no tariff needed for it)
//   • Manual readings with (generated placeholder) meter photos, one verified by a second person
//   • A missing closing reading → estimated charge → reading arrives → automatic true-up
//   • Draft tenant and owner statements (one tenant statement approved to demonstrate tenant access)
//   • Users: a manager, a portal owner and two portal tenants (tenant access restrictions are checked below)
// ALL TARIFFS AND AMOUNTS ARE DEMONSTRATION FIGURES — not municipal or legally authorised rates.
// ============================================================================================================

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
// Never a real provider while seeding demo data.
for (const k of ['RESEND_API_KEY', 'RESEND_FROM_ADDRESS', 'SMART_UTILITY_TENANT_STATEMENTS_ENABLED', 'SMART_UTILITY_AUTO_SUBMISSION_ENABLED', 'WHATSAPP_ACCESS_TOKEN']) {
  delete process.env[k];
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const local = /^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/.test(URL_);
const confirmed = process.env.PILOT_DEMO_CONFIRM === 'disposable';
const password = process.env.PILOT_DEMO_PASSWORD ?? '';

/** Placeholder "meter photo": a generated grey PNG with a dark band (no real photo, no personal data). */
function placeholderPng(width = 96, height = 64): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const band = y > height / 3 && y < (2 * height) / 3;
      const v = band ? 40 : 200;
      row[1 + x * 3] = v;
      row[2 + x * 3] = v;
      row[3 + x * 3] = band ? 60 : v;
    }
    rows.push(row);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('Smart Utilities pilot demonstration data (DISPOSABLE database only)', () => {
  it('refuses to run anywhere but a confirmed, disposable local stack', async () => {
    expect(local, `NEXT_PUBLIC_SUPABASE_URL must be the local stack, got ${URL_}`).toBe(true);
    expect(confirmed, 'set PILOT_DEMO_CONFIRM=disposable to confirm this is a throw-away database').toBe(true);
    expect(password.length, 'set PILOT_DEMO_PASSWORD (12+ characters) for the demo users').toBeGreaterThanOrEqual(12);
    const service = createClient(URL_, SERVICE_KEY, opts);
    const { count } = await service.from('organizations').select('id', { count: 'exact', head: true });
    expect(count ?? 0, 'more than 200 organisations: this looks like a preserved or customer database — refusing').toBeLessThan(200);
  });

  it('seeds the seven-flat pilot property and checks every figure independently', async () => {
    if (!local || !confirmed || password.length < 12) return; // the guard test above already failed
    const service: SupabaseClient = createClient(URL_, SERVICE_KEY, opts);
    const { count } = await service.from('organizations').select('id', { count: 'exact', head: true });
    if ((count ?? 0) >= 200) return;

    const billing = await import('@/lib/smartUtility/billing');
    const statements = await import('@/lib/smartUtility/statements');
    const { loadHybridDashboard } = await import('@/lib/smartUtility/hybridDashboard');
    const { sastInstant } = await import('@/lib/smartUtility/consumption');
    const { storeServerGeneratedObject } = await import('@/lib/protectedStorage');

    const run = Date.now().toString(36);
    const ins = async (table: string, row: Record<string, unknown>) => {
      const { data, error } = await service.from(table).insert(row).select('id').single();
      if (error) throw new Error(`${table}: ${error.message}`);
      return data!.id as string;
    };
    const user = async (role: string, name: string) => {
      const email = `demo-${role}-${run}@demo.proplyst.example`;
      const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
      if (error) throw new Error(error.message);
      return { id: data.user!.id, email };
    };
    const signIn = async (email: string) => {
      const c = createClient(URL_, ANON_KEY, opts);
      const { error } = await c.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      return c;
    };

    // ------------------------------------------------------------------ people and organisation
    const manager = await user('manager', 'Demo Manager');
    const owner = await user('owner', 'Demo Owner');
    const tenantA = await user('tenant-f1', 'Demo Tenant F1');
    const tenantB = await user('tenant-f2', 'Demo Tenant F2');
    const orgId = await ins('organizations', { legal_name: `DEMO — Protea Property Management (fictional) ${run}`, org_type: 'agency', utilities_enabled: true });
    await service.from('organization_members').insert({ org_id: orgId, user_id: manager.id, role: 'principal', status: 'active', joined_at: new Date().toISOString(), property_access_mode: 'all' });
    const P = await ins('properties', { org_id: orgId, nickname: 'DEMO Protea Gardens (fictional)', address_line1: '1 Demo Road', city: 'Pietermaritzburg', province: 'KwaZulu-Natal', postal_code: '3201' });
    await service.from('property_access').insert({ property_id: P, user_id: owner.id, property_role: 'owner' });

    const u: Record<string, string> = {};
    const leaseOf: Record<string, string> = {};
    for (let i = 1; i <= 7; i++) u[`F${i}`] = await ins('units', { org_id: orgId, property_id: P, unit_label: `F${i}` });
    const lease = async (flat: string, name: string, start: string, end: string | null, status: string, userId: string | null = null) => {
      const tenantId = await ins('tenants', { org_id: orgId, full_name: `${name} (demo)`, status: 'active', user_id: userId });
      const leaseId = await ins('leases', { org_id: orgId, unit_id: u[flat], start_date: start, end_date: end, rent_amount: 6500, status });
      await service.from('lease_tenants').insert({ lease_id: leaseId, tenant_id: tenantId, is_primary: true });
      leaseOf[`${flat}:${name}`] = leaseId;
      return tenantId;
    };
    await lease('F1', 'Tenant F1', '2026-01-01', null, 'active', tenantA.id);
    await lease('F2', 'Tenant F2', '2026-01-01', null, 'active', tenantB.id);
    await lease('F3', 'Tenant F3', '2026-01-01', null, 'active');
    await lease('F4', 'Tenant F4', '2026-01-01', null, 'active');
    await lease('F5', 'Tenant F5 (moved out)', '2025-06-01', '2026-10-15', 'terminated');
    await lease('F5', 'Tenant F5 (moved in)', '2026-10-16', null, 'active');
    await lease('F6', 'Tenant F6', '2026-01-01', null, 'active');
    // F7 is vacant: monitored only.

    // ------------------------------------------------------------------ supply sources (monitoring only)
    const source = (utility: string, type: string, name: string, extra: Record<string, unknown> = {}) =>
      ins('utility_supply_sources', { org_id: orgId, property_id: P, utility_type: utility, source_type: type, name, ...extra });
    const grid = await source('electricity', 'municipal_grid', 'Municipal electricity (demo)');
    const pv = await source('electricity', 'solar_pv', 'Rooftop solar (demo)');
    const muni = await source('water', 'municipal', 'Municipal water (demo)');
    const bh = await source('water', 'borehole', 'Borehole (demo)');
    const tank = await source('water', 'storage_tank', 'JoJo tank 5 000 L (demo)', { capacity_value: 5000, capacity_unit: 'litres', low_level_pct: 20 });

    // ------------------------------------------------------------------ meters + readings
    const reading = (meterId: string, y: number, m: number, d: number, v: number, extra: Record<string, unknown> = {}) => ({
      org_id: orgId, property_id: P, meter_id: meterId, read_at: sastInstant(y, m, d).toISOString(), raw_value: v, multiplier: 1, value: v, source: 'device', status: 'valid', ...extra,
    });
    const meter = async (row: Record<string, unknown>, readings: [number, number, number, number][]) => {
      const id = await ins('utility_meters', { org_id: orgId, property_id: P, responsibility_mode: 'owner_paid', ...row });
      if (readings.length) {
        const { error } = await service.from('meter_telemetry_readings').insert(readings.map(([y, m, d, v]) => reading(id, y, m, d, v)));
        if (error) throw new Error(error.message);
      }
      return id;
    };
    const oct = (a: number, b: number): [number, number, number, number][] => [[2026, 10, 1, a], [2026, 11, 1, b]];
    const nonBillable: string[] = [];
    const mainElec = await meter({ utility_type: 'electricity', meter_role: 'main', measurement_kind: 'consumption', location: 'Main DB (demo)' }, oct(0, 1450));
    const mainWater = await meter({ utility_type: 'water', meter_role: 'main', measurement_kind: 'consumption', location: 'Erf connection (demo)' }, oct(0, 52_000));
    nonBillable.push(
      mainElec,
      mainWater,
      await meter({ utility_type: 'electricity', meter_role: 'main', measurement_kind: 'grid_import', supply_source_id: grid }, oct(20_000, 20_600)),
      await meter({ utility_type: 'electricity', meter_role: 'check', measurement_kind: 'generation', supply_source_id: pv }, oct(0, 880)),
      await meter({ utility_type: 'water', meter_role: 'check', measurement_kind: 'source_supply', supply_source_id: muni }, oct(0, 34_000)),
      await meter({ utility_type: 'water', meter_role: 'check', measurement_kind: 'source_supply', supply_source_id: bh }, oct(0, 16_000)),
    );
    const sub = (flat: string, utility: string, parent: string) => ({ unit_id: u[flat], utility_type: utility, meter_role: 'submeter', measurement_kind: 'consumption', parent_meter_id: parent });
    const m: Record<string, string> = {};
    m.F1e = await meter(sub('F1', 'electricity', mainElec), []); // manual readings with photos, below
    m.F1w = await meter(sub('F1', 'water', mainWater), oct(0, 8_000));
    m.F2e = await meter(sub('F2', 'electricity', mainElec), oct(0, 150));
    m.F2w = await meter(sub('F2', 'water', mainWater), oct(0, 5_000));
    m.F3e = await meter(sub('F3', 'electricity', mainElec), oct(0, 130));
    m.F3w = await meter(sub('F3', 'water', mainWater), oct(0, 12_000));
    m.F4e = await meter(sub('F4', 'electricity', mainElec), oct(0, 175));
    m.F5e = await meter(sub('F5', 'electricity', mainElec), [[2026, 10, 1, 0], [2026, 10, 16, 50], [2026, 11, 1, 90]]);
    m.F6e = await meter(sub('F6', 'electricity', mainElec), [[2026, 9, 1, 0], [2026, 10, 1, 300]]); // 1 Nov reading MISSING
    m.F7e = await meter(sub('F7', 'electricity', mainElec), oct(0, 12)); // vacant flat, monitoring only
    const shared = await meter({ utility_type: 'water', meter_role: 'check', measurement_kind: 'consumption', parent_meter_id: mainWater, location: 'F4 + F6 shared (demo)' }, oct(0, 20_000));

    // F1: manual readings captured on site with a meter photo; the November one verified by the owner's agent.
    const photo = placeholderPng();
    const { data: cat } = await service.from('document_categories').select('id').eq('slug', 'electricity').single();
    const photoDoc = async (label: string) => {
      const path = `${orgId}/${P}/${crypto.randomUUID()}.png`;
      const stored = await storeServerGeneratedObject({ orgId, path, bytes: photo, contentType: 'image/png' });
      if (!stored.ok) throw new Error(stored.error.message);
      return ins('documents', {
        org_id: orgId, property_id: P, unit_id: u.F1, category_id: cat!.id, document_type: 'bill', uploaded_by: manager.id, storage_path: path,
        original_file_name: `DEMO-placeholder-meter-photo-${label}.png`, mime_type: 'image/png', file_size_bytes: photo.length,
        checksum_sha256: (await import('node:crypto')).createHash('sha256').update(photo).digest('hex'),
      });
    };
    {
      const { error } = await service.from('meter_telemetry_readings').insert([
        reading(m.F1e!, 2026, 10, 1, 0, { source: 'manual', recorded_by: manager.id, document_id: await photoDoc('F1-1-oct'), verification_status: 'unverified', notes: 'DEMO manual reading' }),
        reading(m.F1e!, 2026, 11, 1, 200, {
          source: 'manual', recorded_by: manager.id, document_id: await photoDoc('F1-1-nov'), verification_status: 'verified', verified_by: owner.id, verified_at: new Date().toISOString(),
          verification_note: 'DEMO: photo matches the register', notes: 'DEMO manual reading',
        }),
      ]);
      if (error) throw new Error(error.message);
    }
    // Tank levels (never billed) and a tanker delivery (logged cost).
    await service.from('utility_source_readings').insert([
      { org_id: orgId, property_id: P, source_id: tank, metric: 'tank_level_pct', read_at: sastInstant(2026, 10, 1).toISOString(), value: 45, source: 'manual' },
      { org_id: orgId, property_id: P, source_id: tank, metric: 'tank_level_pct', read_at: sastInstant(2026, 11, 1).toISOString(), value: 65, source: 'manual' },
    ]);
    await service.from('utility_source_logs').insert({ org_id: orgId, property_id: P, source_id: tank, log_type: 'tanker_delivery', occurred_at: sastInstant(2026, 10, 9, 10).toISOString(), quantity: 2, quantity_unit: 'kL', cost_amount: 950, notes: 'DEMO delivery' });

    // ------------------------------------------------------------------ fictional tariffs + arrangements
    const { error: tErr } = await service.from('utility_tariffs').insert([
      { org_id: orgId, property_id: P, utility_type: 'electricity', name: 'DEMO FICTIONAL electricity R3,00/kWh + R60', tariff_kind: 'flat', fixed_charge: 60, blocks: [{ upTo: null, rate: 3 }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-01-01', source_reference: 'Demonstration figure — not a municipal tariff' },
      { org_id: orgId, property_id: P, utility_type: 'water', name: 'DEMO FICTIONAL water blocks', tariff_kind: 'block', fixed_charge: 0, blocks: [{ upTo: 6, rate: 20 }, { upTo: 15, rate: 30 }, { upTo: null, rate: 50 }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-01-01', source_reference: 'Demonstration figure — not a municipal tariff' },
    ]);
    if (tErr) throw new Error(tErr.message);
    const group = await ins('utility_allocation_groups', { org_id: orgId, property_id: P, meter_id: shared, name: 'DEMO F4 + F6 shared water', method: 'equal', landlord_share_pct: 0 });
    await service.from('utility_allocation_members').insert(['F4', 'F6'].map((f) => ({ group_id: group, org_id: orgId, property_id: P, unit_id: u[f] })));
    const arr = (flat: string, utility: string, arrangement: string, extra: Record<string, unknown> = {}) => ({
      org_id: orgId, property_id: P, unit_id: u[flat], utility_type: utility, arrangement, effective_from: '2026-01-01', invoice_mode: 'separate_invoice', ...extra,
    });
    const { error: aErr } = await service.from('utility_billing_arrangements').insert([
      arr('F1', 'electricity', 'metered_recharge'),
      arr('F1', 'water', 'metered_recharge'),
      arr('F2', 'electricity', 'included_in_rent'),
      arr('F2', 'water', 'landlord_paid'),
      arr('F3', 'electricity', 'fixed_allowance', { fixed_amount: 400, allowance_quantity: 100 }),
      arr('F3', 'water', 'metered_recharge'),
      arr('F4', 'electricity', 'fixed_allowance', { fixed_amount: 350, allowance_quantity: null }),
      arr('F4', 'water', 'shared_allocation', { allocation_group_id: group }),
      arr('F5', 'electricity', 'metered_recharge'),
      arr('F6', 'electricity', 'metered_recharge'),
      arr('F6', 'water', 'shared_allocation', { allocation_group_id: group }),
      // F7 (vacant): no arrangement — monitored only.
    ]);
    if (aErr) throw new Error(aErr.message);

    // ------------------------------------------------------------------ charges: Sept history for F6, then October
    await billing.generateCharges(service, { propertyId: P, periodStart: '2026-09-01', periodEnd: '2026-10-01', actorUserId: manager.id });
    const live = async () => (await service.from('utility_charges').select('*, units(unit_label)').eq('property_id', P).neq('status', 'void')).data ?? [];
    const sept = (await live()).filter((c) => c.period_start === '2026-09-01');
    await billing.voidCharges(service, { chargeIds: sept.filter((c) => c.unit_id !== u.F6).map((c) => c.id), propertyId: P, actorUserId: manager.id });
    await billing.generateCharges(service, { propertyId: P, periodStart: '2026-10-01', periodEnd: '2026-11-01', actorUserId: manager.id, estimateMissing: true });

    const octLines = (await live()).filter((c) => c.period_start === '2026-10-01');
    const by = (flat: string, utility: string) =>
      octLines.filter((c) => c.unit_id === u[flat] && c.utility_type === utility).map((c) => `${c.charge_type}:${Number(c.total_amount).toFixed(2)}`).sort();
    // Independent expectations (DEMO tariffs): see docs/UTILITIES_PILOT_DEMO.md for the arithmetic.
    expect(by('F1', 'electricity')).toEqual(['consumption:660.00']); // 200 × 3 + 60
    expect(by('F1', 'water')).toEqual(['consumption:180.00']); // 6×20 + 2×30
    expect(by('F2', 'electricity')).toEqual([]); // included in rent
    expect(by('F2', 'water')).toEqual([]); // landlord pays
    expect(by('F3', 'electricity')).toEqual(['allowance_fee:400.00', 'excess:90.00']); // R400 incl. 100 kWh; 30 × 3
    expect(by('F3', 'water')).toEqual(['consumption:300.00']); // 6×20 + 6×30
    expect(by('F4', 'electricity')).toEqual(['allowance_fee:350.00']);
    expect(by('F4', 'water')).toEqual(['allocation:320.00']); // 20 kL = R640, equal split
    expect(by('F5', 'electricity')).toEqual(['consumption:150.97', 'consumption:179.03']); // 120 + 60×16/31; 150 + 60×15/31
    expect(by('F6', 'electricity')).toEqual(['consumption:990.00']); // ESTIMATED 10/day × 31 = 310 kWh → 930 + 60
    expect(by('F6', 'water')).toEqual(['allocation:320.00']);
    expect(by('F7', 'electricity')).toEqual([]); // vacant, monitored only
    for (const c of octLines) expect(nonBillable).not.toContain(c.meter_id);
    const total = octLines.reduce((a, c) => a + Math.round(Number(c.total_amount) * 100), 0);
    expect(total).toBe(66000 + 18000 + 40000 + 9000 + 30000 + 35000 + 32000 + 15097 + 17903 + 99000 + 32000); // R3 940,00

    // Approve the month (F6's estimate included: only approved/invoiced estimates are trued up); F6's reading then
    // arrives and the true-up appears as a separate DRAFT charge for review.
    const f6Estimate = octLines.find((c) => c.unit_id === u.F6 && c.utility_type === 'electricity')!;
    expect(f6Estimate.review_flags).toContain('estimated_consumption_true_up_pending');
    await billing.approveCharges(service, { chargeIds: octLines.map((c) => c.id), propertyId: P, actorUserId: manager.id });
    await service.from('meter_telemetry_readings').insert(reading(m.F6e!, 2026, 11, 1, 630, { source: 'manual', recorded_by: manager.id, notes: 'DEMO late reading' }));
    const trueUpRun = await billing.generateCharges(service, { propertyId: P, periodStart: '2026-10-01', periodEnd: '2026-11-01', actorUserId: manager.id });
    expect(trueUpRun.created).toBe(1);
    const trueUp = (await live()).find((c) => c.charge_type === 'true_up')!;
    expect(Number(trueUp.total_amount)).toBe(60); // (330 − 310) × 3
    expect(trueUp.status).toBe('draft');

    // ------------------------------------------------------------------ statements (draft; one tenant statement approved)
    const tenantStatements = await statements.generateStatements(service, { propertyId: P, periodStart: '2026-10-01', periodEnd: '2026-11-01', audience: 'tenant', actorUserId: manager.id });
    const ownerStatements = await statements.generateStatements(service, { propertyId: P, periodStart: '2026-10-01', periodEnd: '2026-11-01', audience: 'owner', actorUserId: manager.id });
    expect(tenantStatements.created).toBeGreaterThan(0);
    expect(ownerStatements.created).toBe(1);
    const { data: f1Statement } = await service.from('utility_statements').select('id').eq('property_id', P).eq('audience', 'tenant').eq('lease_id', leaseOf['F1:Tenant F1']).single();
    await statements.statementAction(service, { statementId: f1Statement!.id, propertyId: P, action: 'approve', actorUserId: manager.id });

    // ------------------------------------------------------------------ access restrictions, as each person
    const tenantAClient = await signIn(tenantA.email);
    const tenantBClient = await signIn(tenantB.email);
    const ownerClient = await signIn(owner.email);
    const seenByA = (await tenantAClient.from('utility_statements').select('id, audience, status')).data ?? [];
    expect(seenByA).toEqual([{ id: f1Statement!.id, audience: 'tenant', status: 'approved' }]); // own, approved only
    expect((await tenantBClient.from('utility_statements').select('id')).data).toEqual([]); // F2: nothing approved
    expect((await tenantBClient.from('utility_tariffs').select('id')).data).toEqual([]); // tenants never see tariffs
    expect((await tenantBClient.from('meter_telemetry_readings').select('id')).data).toEqual([]);
    const ownerDash = await loadHybridDashboard(ownerClient, P, { from: '2026-10-01', to: '2026-11-01' });
    expect(ownerDash.electricity.measuredConsumption.value).toBe(1450); // owner sees the consumption dashboard
    expect((await ownerClient.from('utility_tariffs').insert({ org_id: orgId, property_id: P, utility_type: 'water', name: 'x', blocks: [{ upTo: null, rate: 1 }], effective_from: '2026-01-01' })).error).not.toBeNull(); // owner cannot set prices

    console.warn(
      `[pilot demo] seeded org ${orgId} property ${P} (run ${run}). Sign in as demo-manager-${run}@demo.proplyst.example, ` +
        `demo-owner-${run}@…, demo-tenant-f1-${run}@… or demo-tenant-f2-${run}@… with PILOT_DEMO_PASSWORD. DEMONSTRATION DATA — fictional tariffs.`,
    );
  }, 300_000);
});
