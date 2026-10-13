import { deflateSync, crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ============================================================================================================
// CLIENT DEMO PROVISIONER — fictional "DEMO" portfolio for a DEDICATED DEMO Supabase project (or the local stack).
//
//   DEMO_SUPABASE_URL=https://<demo-ref>.supabase.co  DEMO_SERVICE_ROLE_KEY=...  DEMO_ANON_KEY=...
//   DEMO_CONFIRM=fictional-demo  DEMO_LOGIN_EMAIL=...  DEMO_LOGIN_PASSWORD=...  [DEMO_TENANT_EMAIL=...]
//   npx vitest run -c vitest.demo.config.ts scripts/client-demo            (from apps/admin)
//
// REFUSES: the production project (radqoboichldiucydrgy), a missing DEMO_CONFIRM, or any database that already
// holds 50+ organisations. Never prints keys or passwords. Creates one new DEMO organisation per run.
// Everything is FICTIONAL: people, property, tariffs ("DEMO FICTIONAL"), readings (source 'simulator' — shown as
// simulated, never as a connected device), photos (generated placeholders). Nothing is sent, issued or paid:
// invoices are DRAFTS, municipal packs await approval, sending flags are not touched.
// ============================================================================================================

const PRODUCTION_REF = 'radqoboichldiucydrgy';
const URL_ = process.env.DEMO_SUPABASE_URL ?? '';
const SERVICE = process.env.DEMO_SERVICE_ROLE_KEY ?? '';
const ANON = process.env.DEMO_ANON_KEY ?? '';
const LOGIN_EMAIL = process.env.DEMO_LOGIN_EMAIL ?? '';
const LOGIN_PASSWORD = process.env.DEMO_LOGIN_PASSWORD ?? '';
const TENANT_EMAIL = process.env.DEMO_TENANT_EMAIL ?? '';
const SAFE = URL_.length > 0 && !URL_.includes(PRODUCTION_REF) && process.env.DEMO_CONFIRM === 'fictional-demo' && SERVICE.length > 20 && ANON.length > 20 && LOGIN_PASSWORD.length >= 12 && /@/.test(LOGIN_EMAIL);

// The app's libraries read these; point them at the DEMO project only (after the guard).
if (SAFE) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON;
}
for (const k of ['RESEND_API_KEY', 'RESEND_FROM_ADDRESS', 'SMART_UTILITY_TENANT_STATEMENTS_ENABLED', 'SMART_UTILITY_AUTO_SUBMISSION_ENABLED', 'WHATSAPP_ACCESS_TOKEN', 'PAYFAST_MERCHANT_ID', 'PAYFAST_MERCHANT_KEY']) {
  delete process.env[k];
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const DAY = 86_400_000;

/** Deterministic pseudo-random in [0, 1) so every run produces the same, believable series. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function placeholderPng(): Buffer {
  const w = 120, h = 80;
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const dial = y > 30 && y < 50 && x > 20 && x < 100;
      row[1 + x * 3] = dial ? 30 : 210; row[2 + x * 3] = dial ? 30 : 210; row[3 + x * 3] = dial ? 40 : 215;
    }
    rows.push(row);
  }
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const body = Buffer.concat([Buffer.from(t, 'ascii'), d]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

describe('Client demo provisioner (DEMO project only)', () => {
  it('refuses anything but a confirmed, non-production demo database', async () => {
    expect(URL_.includes(PRODUCTION_REF), 'this is the PRODUCTION project — refusing').toBe(false);
    expect(SAFE, 'set DEMO_SUPABASE_URL, DEMO_SERVICE_ROLE_KEY, DEMO_ANON_KEY, DEMO_CONFIRM=fictional-demo, DEMO_LOGIN_EMAIL and DEMO_LOGIN_PASSWORD (12+ chars)').toBe(true);
    const service = createClient(URL_, SERVICE, opts);
    const { count, error } = await service.from('organizations').select('id', { count: 'exact', head: true });
    expect(error).toBeNull();
    expect(count ?? 0, '50+ organisations: not a dedicated demo database — refusing').toBeLessThan(50);
  });

  it('provisions the fictional six-unit demo portfolio', async () => {
    if (!SAFE) return;
    const service: SupabaseClient = createClient(URL_, SERVICE, opts);
    const { count } = await service.from('organizations').select('id', { count: 'exact', head: true });
    if ((count ?? 0) >= 50) return;

    const billing = await import('@/lib/smartUtility/billing');
    const statements = await import('@/lib/smartUtility/statements');
    const { generateSubmission } = await import('@/lib/smartUtility/submissions');
    const { runSmartUtilityJob } = await import('@/lib/smartUtility/jobs');
    const { sastInstant, sastParts } = await import('@/lib/smartUtility/consumption');
    const { storeServerGeneratedObject } = await import('@/lib/protectedStorage');
    const { recordLegalConsent } = await import('@/lib/legalConsent');

    const ins = async (table: string, row: Record<string, unknown>) => {
      const { data, error } = await service.from(table).insert(row).select('id').single();
      if (error) throw new Error(`${table}: ${error.message}`);
      return data!.id as string;
    };
    const readyUser = async (email: string, first: string, last: string) => {
      const { data: existing } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
      let id = existing?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
      if (!id) {
        const { data, error } = await service.auth.admin.createUser({ email, password: LOGIN_PASSWORD, email_confirm: true, user_metadata: { full_name: `${first} ${last}` } });
        if (error) throw new Error(`user: ${error.message}`);
        id = data.user!.id;
      } else {
        await service.auth.admin.updateUserById(id, { password: LOGIN_PASSWORD, email_confirm: true });
      }
      await recordLegalConsent(id);
      await service.from('profiles').update({ first_name: first, last_name: last, display_name: `${first} ${last}`, phone_e164: '+27821234567', profile_completed_at: new Date().toISOString() }).eq('id', id);
      return id;
    };

    // ------------------------------------------------------------------ organisation, people
    const managerId = await readyUser(LOGIN_EMAIL, 'Demo', 'Manager');
    const orgId = await ins('organizations', { legal_name: 'DEMO — Umhlanga Ridge Property Management (fictional)', trading_name: 'DEMO Umhlanga Ridge PM', org_type: 'agency', utilities_enabled: true });
    await service.rpc('activate_trial_after_payment', { p_org_id: orgId }); // demo org: commercially ready, no payment taken
    await service.from('organization_members').insert({ org_id: orgId, user_id: managerId, role: 'principal', status: 'active', joined_at: new Date().toISOString(), property_access_mode: 'all' });
    const tenantUserId = TENANT_EMAIL ? await readyUser(TENANT_EMAIL, 'Thandiwe', 'Mokoena') : null;

    const P = await ins('properties', { org_id: orgId, nickname: 'DEMO Ridgeview Apartments', address_line1: '12 Ridgeview Crescent', city: 'Umhlanga', province: 'KwaZulu-Natal', postal_code: '4319' });

    const units: Record<string, string> = {};
    const leaseOf: Record<string, string> = {};
    const people: Record<string, [string, string | null]> = {
      'Unit 1': ['Thandiwe Mokoena', tenantUserId],
      'Unit 2': ['Pieter van der Merwe', null],
      'Unit 3': ['Ayesha Patel', null],
      'Unit 4': ['Sipho Ndlovu', null],
      'Unit 5': ['Lerato Khumalo', null],
    };
    for (const [i, label] of ['Unit 1', 'Unit 2', 'Unit 3', 'Unit 4', 'Unit 5', 'Unit 6'].entries()) {
      units[label] = await ins('units', { org_id: orgId, property_id: P, unit_label: label, size_sqm: [72, 68, 48, 52, 95, 90][i] });
      const person = people[label];
      if (!person) continue; // Unit 6 is vacant
      const tenantId = await ins('tenants', { org_id: orgId, full_name: `${person[0]} (demo)`, status: 'active', user_id: person[1], email: person[1] ? TENANT_EMAIL : null });
      const leaseId = await ins('leases', { org_id: orgId, unit_id: units[label], start_date: '2026-02-01', end_date: '2027-01-31', rent_amount: [11500, 10800, 8200, 8900, 14500][i], status: 'active' });
      await service.from('lease_tenants').insert({ lease_id: leaseId, tenant_id: tenantId, is_primary: true });
      leaseOf[label] = leaseId;
    }

    // ------------------------------------------------------------------ supply sources (monitoring)
    const src = (utility: string, type: string, name: string, extra: Record<string, unknown> = {}) =>
      ins('utility_supply_sources', { org_id: orgId, property_id: P, utility_type: utility, source_type: type, name, ...extra });
    const grid = await src('electricity', 'municipal_grid', 'eThekwini electricity (municipal)');
    const pv = await src('electricity', 'solar_pv', 'Rooftop solar 12 kWp');
    const battery = await src('electricity', 'battery', 'Battery 20 kWh', { level_metric: 'battery_soc_pct', low_level_pct: 20 });
    const genset = await src('electricity', 'generator', 'Diesel generator 15 kVA', { fuel_type: 'diesel', expected_daily_run_hours: 2 });
    const muniWater = await src('water', 'municipal', 'eThekwini water (municipal)');
    const borehole = await src('water', 'borehole', 'Borehole (garden & tank top-up)');
    const tank = await src('water', 'storage_tank', 'JoJo tanks 10 000 L', { capacity_value: 10000, capacity_unit: 'litres', level_metric: 'tank_level_pct', low_level_pct: 20 });

    // ------------------------------------------------------------------ meters
    const meter = (row: Record<string, unknown>) => ins('utility_meters', { org_id: orgId, property_id: P, responsibility_mode: 'owner_paid', connectivity: 'simulator', expected_interval_minutes: 1440, ...row });
    const m: Record<string, string> = {};
    m.mainE = await meter({ utility_type: 'electricity', meter_role: 'main', measurement_kind: 'consumption', ownership: 'private', location: 'Main distribution board', meter_number: 'DEMO-ME-001' });
    m.grid = await meter({ utility_type: 'electricity', meter_role: 'main', measurement_kind: 'grid_import', supply_source_id: grid, ownership: 'municipal', meter_number: 'DEMO-ETH-E-4471', municipal_account_number: 'DEMO-5100448812' });
    m.solar = await meter({ utility_type: 'electricity', meter_role: 'check', measurement_kind: 'generation', supply_source_id: pv, location: 'Inverter PV input' });
    m.batIn = await meter({ utility_type: 'electricity', meter_role: 'check', measurement_kind: 'battery_charge', supply_source_id: battery });
    m.batOut = await meter({ utility_type: 'electricity', meter_role: 'check', measurement_kind: 'battery_discharge', supply_source_id: battery });
    m.gen = await meter({ utility_type: 'electricity', meter_role: 'check', measurement_kind: 'generator_output', supply_source_id: genset });
    m.pump = await meter({ utility_type: 'electricity', meter_role: 'check', measurement_kind: 'pump_energy', supply_source_id: borehole, location: 'Borehole pump' });
    m.mainW = await meter({ utility_type: 'water', meter_role: 'main', measurement_kind: 'consumption', ownership: 'municipal', location: 'Erf connection', meter_number: 'DEMO-ETH-W-9930', municipal_account_number: 'DEMO-5100448812' });
    m.muniW = await meter({ utility_type: 'water', meter_role: 'check', measurement_kind: 'source_supply', supply_source_id: muniWater });
    m.boreW = await meter({ utility_type: 'water', meter_role: 'check', measurement_kind: 'source_supply', supply_source_id: borehole });
    const sub = (label: string, utility: string, parent: string, num: string) => meter({ unit_id: units[label], utility_type: utility, meter_role: 'submeter', measurement_kind: 'consumption', parent_meter_id: parent, meter_number: num, location: `${label} DB` });
    for (const [i, label] of ['Unit 1', 'Unit 2', 'Unit 3', 'Unit 4', 'Unit 5', 'Unit 6'].entries()) {
      m[`${label}E`] = await sub(label, 'electricity', m.mainE, `DEMO-E-${101 + i}`);
      if (i < 4) m[`${label}W`] = await sub(label, 'water', m.mainW, `DEMO-W-${101 + i}`);
      if (label === 'Unit 4') await service.from('utility_meters').update({ expected_interval_minutes: 60 }).eq('id', m[`${label}W`]); // hourly: night-flow rule
    }
    m.sharedW = await meter({ utility_type: 'water', meter_role: 'check', measurement_kind: 'consumption', parent_meter_id: m.mainW, location: 'Units 5 & 6 shared water', meter_number: 'DEMO-W-SH1' });

    // ------------------------------------------------------------------ 120 days of simulated daily readings to today
    const today = sastParts(new Date());
    const end = sastInstant(today.year, today.month, today.day); // 00:00 SAST today
    const days = 120;
    const r = rng(20261014);
    const daily: Record<string, number[]> = {};
    const unitE = { 'Unit 1': 9.5, 'Unit 2': 7.8, 'Unit 3': 6.2, 'Unit 4': 8.4, 'Unit 5': 12.1, 'Unit 6': 3.2 } // Unit 6 is vacant: a fridge left on (vacant-unit alert) as Record<string, number>;
    const unitW = { 'Unit 1': 0.42, 'Unit 2': 0.31, 'Unit 3': 0.24, 'Unit 4': 0.36 } as Record<string, number>;
    for (let d = 0; d < days; d++) {
      const wave = 1 + 0.18 * Math.sin((d / 7) * 2 * Math.PI) + (r() - 0.5) * 0.2;
      const loadShedding = d % 9 === 3;
      let unitsTotal = 0;
      for (const [label, base] of Object.entries(unitE)) {
        // Unit 5: yesterday ~3.5x its usual use (spike alert to discuss).
        const v = +(base * wave * (label === 'Unit 5' && d === days - 1 ? 3.5 : 1)).toFixed(2);
        (daily[`${label}E`] ??= []).push(v);
        unitsTotal += v;
      }
      const common = +(6 + r() * 2).toFixed(2);
      const consumption = unitsTotal + common;
      const solar = +(26 + 10 * Math.sin((d / 30) * Math.PI) + (r() - 0.5) * 8).toFixed(2);
      const charge = +Math.min(11, solar * 0.32).toFixed(2);
      const discharge = +(charge * 0.9).toFixed(2);
      const gen = loadShedding ? +(5 + r() * 3).toFixed(2) : 0;
      const pump = +(2.6 + r() * 0.8).toFixed(2);
      const gridImport = Math.max(0, +(consumption + pump - solar + charge - discharge - gen).toFixed(2));
      (daily.mainE ??= []).push(+consumption.toFixed(2));
      (daily.solar ??= []).push(solar); (daily.batIn ??= []).push(charge); (daily.batOut ??= []).push(discharge);
      (daily.gen ??= []).push(gen); (daily.pump ??= []).push(pump); (daily.grid ??= []).push(gridImport);
      let unitsW = 0;
      for (const [label, base] of Object.entries(unitW)) {
        const v = +(base * (0.85 + r() * 0.3) * 1000).toFixed(0);
        (daily[`${label}W`] ??= []).push(v);
        unitsW += v;
      }
      const shared = +(380 + r() * 90).toFixed(0);
      (daily.sharedW ??= []).push(shared);
      const mainW = unitsW + shared + +(140 + r() * 60).toFixed(0); // + garden/common
      (daily.mainW ??= []).push(mainW);
      const bore = +(mainW * 0.38).toFixed(0);
      (daily.boreW ??= []).push(bore); (daily.muniW ??= []).push(mainW - bore + +(r() * 20).toFixed(0));
    }
    const rows: Record<string, unknown>[] = [];
    for (const [key, series] of Object.entries(daily)) {
      let cum = 1000 + Math.round(r() * 5000);
      rows.push({ meter_id: m[key], read_at: new Date(end.getTime() - days * DAY).toISOString(), raw_value: cum, value: cum });
      series.forEach((v, i) => {
        cum = +(cum + v).toFixed(3);
        rows.push({ meter_id: m[key], read_at: new Date(end.getTime() - (days - 1 - i) * DAY).toISOString(), raw_value: cum, value: cum });
      });
    }
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await service.from('meter_telemetry_readings').insert(
        rows.slice(i, i + 1000).map((x) => ({ ...x, org_id: orgId, property_id: P, multiplier: 1, source: 'simulator', status: 'valid', notes: 'Simulated demo reading' })),
      );
      if (error) throw new Error(`readings: ${error.message}`);
    }
    // Unit 4 water: hourly readings for the last 3 days with a continuous overnight trickle (a leak to discover).
    {
      const base = (rows.filter((x) => x.meter_id === m['Unit 4W']).at(-1)!.value as number);
      const hourly: Record<string, unknown>[] = [];
      let cum = base;
      for (let h = 1; h <= 72; h++) {
        const at = new Date(end.getTime() - 3 * DAY + h * 3_600_000);
        const hour = (at.getUTCHours() + 2) % 24;
        cum = +(cum + (hour >= 0 && hour < 5 ? 9 : hour >= 6 && hour < 9 ? 45 : 14)).toFixed(3);
        if (at.getTime() <= Date.now()) hourly.push({ org_id: orgId, property_id: P, meter_id: m['Unit 4W'], read_at: at.toISOString(), raw_value: cum + 50, multiplier: 1, value: cum + 50, source: 'simulator', status: 'valid', notes: 'Simulated hourly reading' });
      }
      await service.from('meter_telemetry_readings').insert(hourly);
    }
    // Tank and battery levels (daily), tank low today; tanker delivery and fuel logs.
    const levels: Record<string, unknown>[] = [];
    for (let d = 0; d < 30; d++) {
      const at = new Date(end.getTime() - (29 - d) * DAY + 8 * 3_600_000).toISOString();
      levels.push({ org_id: orgId, property_id: P, source_id: tank, metric: 'tank_level_pct', read_at: at, value: d === 29 ? 14 : Math.round(55 + 20 * Math.sin(d / 4)), source: 'simulator' });
      levels.push({ org_id: orgId, property_id: P, source_id: battery, metric: 'battery_soc_pct', read_at: at, value: Math.round(60 + 25 * Math.sin(d / 3)), source: 'simulator' });
    }
    await service.from('utility_source_readings').insert(levels);
    await service.from('utility_source_logs').insert([
      { org_id: orgId, property_id: P, source_id: tank, log_type: 'tanker_delivery', occurred_at: new Date(end.getTime() - 18 * DAY).toISOString(), quantity: 5, quantity_unit: 'kL', cost_amount: 1850, notes: 'DEMO water delivery during municipal outage' },
      { org_id: orgId, property_id: P, source_id: genset, log_type: 'fuel_purchase', occurred_at: new Date(end.getTime() - 25 * DAY).toISOString(), quantity: 60, quantity_unit: 'litres', cost_amount: 1380, notes: 'DEMO diesel' },
    ]);

    // Manual readings with placeholder photos on Unit 1 electricity (one verified).
    const png = placeholderPng();
    const { data: cat } = await service.from('document_categories').select('id').eq('slug', 'electricity').limit(1).maybeSingle();
    for (const [i, offset] of [12, 5].entries()) {
      const path = `${orgId}/${P}/${crypto.randomUUID()}.png`;
      const stored = await storeServerGeneratedObject({ orgId, path, bytes: png, contentType: 'image/png' });
      if (!stored.ok || !cat) break;
      const docId = await ins('documents', { org_id: orgId, property_id: P, unit_id: units['Unit 1'], category_id: cat.id, document_type: 'bill', uploaded_by: managerId, storage_path: path, original_file_name: `DEMO-placeholder-meter-photo-${i + 1}.png`, mime_type: 'image/png', file_size_bytes: png.length, checksum_sha256: createHash('sha256').update(png).digest('hex') });
      const prior = rows.filter((x) => x.meter_id === m['Unit 1E'])[days - offset]!;
      await service.from('meter_telemetry_readings').insert({
        org_id: orgId, property_id: P, meter_id: m['Unit 1E'], read_at: new Date(new Date(prior.read_at as string).getTime() + 10 * 3_600_000).toISOString(), raw_value: (prior.value as number) + 4, multiplier: 1, value: (prior.value as number) + 4,
        source: 'manual', recorded_by: managerId, document_id: docId, notes: 'DEMO manual reading with photo', verification_status: i === 0 ? 'verified' : 'unverified',
        ...(i === 0 ? { verified_by: managerId, verified_at: new Date().toISOString(), verification_note: 'Photo matches the register' } : {}),
      });
    }

    // ------------------------------------------------------------------ fictional tariffs, arrangements
    const { error: tErr } = await service.from('utility_tariffs').insert([
      { org_id: orgId, property_id: P, utility_type: 'electricity', name: 'DEMO FICTIONAL electricity R3,20/kWh + R65', tariff_kind: 'flat', fixed_charge: 65, blocks: [{ upTo: null, rate: 3.2 }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-01-01', source_reference: 'Demonstration figure — not a municipal tariff' },
      { org_id: orgId, property_id: P, utility_type: 'water', name: 'DEMO FICTIONAL water (stepped)', tariff_kind: 'block', fixed_charge: 0, blocks: [{ upTo: 6, rate: 22 }, { upTo: 15, rate: 34 }, { upTo: null, rate: 55 }], vat_inclusive: true, vat_rate: 15, effective_from: '2026-01-01', source_reference: 'Demonstration figure — not a municipal tariff' },
    ]);
    if (tErr) throw new Error(tErr.message);
    const group = await ins('utility_allocation_groups', { org_id: orgId, property_id: P, meter_id: m.sharedW, name: 'Units 5 & 6 shared water', method: 'floor_area', landlord_share_pct: 0 });
    await service.from('utility_allocation_members').insert(['Unit 5', 'Unit 6'].map((l) => ({ group_id: group, org_id: orgId, property_id: P, unit_id: units[l] })));
    const arr = (label: string, utility: string, arrangement: string, extra: Record<string, unknown> = {}) => ({ org_id: orgId, property_id: P, unit_id: units[label], utility_type: utility, arrangement, effective_from: '2026-01-01', invoice_mode: 'separate_invoice', ...extra });
    const { error: aErr } = await service.from('utility_billing_arrangements').insert([
      arr('Unit 1', 'electricity', 'metered_recharge'), arr('Unit 1', 'water', 'metered_recharge'),
      arr('Unit 2', 'electricity', 'included_in_rent'), arr('Unit 2', 'water', 'landlord_paid'),
      arr('Unit 3', 'electricity', 'fixed_allowance', { fixed_amount: 450, allowance_quantity: 150 }), arr('Unit 3', 'water', 'metered_recharge'),
      arr('Unit 4', 'electricity', 'metered_recharge'), arr('Unit 4', 'water', 'metered_recharge'),
      arr('Unit 5', 'electricity', 'metered_recharge'), arr('Unit 5', 'water', 'shared_allocation', { allocation_group_id: group }),
      arr('Unit 6', 'water', 'shared_allocation', { allocation_group_id: group }), // vacant: its share stays with the landlord
    ]);
    if (aErr) throw new Error(aErr.message);

    // ------------------------------------------------------------------ last complete month: drafts -> approved -> DRAFT invoices; statements
    const firstOfThis = new Date(Date.UTC(today.year, today.month - 1, 1));
    const firstOfLast = new Date(Date.UTC(today.year, today.month - 2, 1));
    const last = { periodStart: firstOfLast.toISOString().slice(0, 10), periodEnd: firstOfThis.toISOString().slice(0, 10) };
    await billing.generateCharges(service, { propertyId: P, ...last, actorUserId: managerId });
    const { data: lastCharges } = await service.from('utility_charges').select('id, unit_id').eq('property_id', P).eq('period_start', last.periodStart).neq('status', 'void');
    expect((lastCharges ?? []).length).toBeGreaterThan(5);
    await billing.approveCharges(service, { chargeIds: lastCharges!.map((c) => c.id), propertyId: P, actorUserId: managerId });
    const session = createClient(URL_, ANON, opts);
    await session.auth.signInWithPassword({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD });
    const toInvoice = lastCharges!.filter((c) => c.unit_id === units['Unit 1'] || c.unit_id === units['Unit 4']).map((c) => c.id);
    const inv = await billing.invoiceCharges(session, service, { chargeIds: toInvoice, propertyId: P, actorUserId: managerId });
    const tenantSt = await statements.generateStatements(service, { propertyId: P, ...last, audience: 'tenant', actorUserId: managerId });
    await statements.generateStatements(service, { propertyId: P, ...last, audience: 'owner', actorUserId: managerId });
    const { data: st1 } = await service.from('utility_statements').select('id').eq('property_id', P).eq('audience', 'tenant').eq('lease_id', leaseOf['Unit 1']).maybeSingle();
    if (st1) await statements.statementAction(service, { statementId: st1.id, propertyId: P, action: 'approve', actorUserId: managerId });
    // The month before is left UNCALCULATED so "Calculate charges" can be shown live.

    // ------------------------------------------------------------------ municipal readings: settings + a pack awaiting approval (no sending)
    await service.from('municipal_submission_settings').upsert({ property_id: P, org_id: orgId, municipality_code: 'ethekwini', municipal_account_number: 'DEMO-5100448812', mode: 'approval_required', billing_day: 1, lead_days: 3, include_photos: true, enabled: false, updated_by: managerId }, { onConflict: 'property_id' });
    await service.from('municipal_submission_recipients').insert({ org_id: orgId, property_id: P, email: 'municipal-readings@demo.proplyst.example', recipient_type: 'custom', label: 'DEMO recipient (not a real address)' }).select('id');
    const pack = await generateSubmission(service, { propertyId: P, period: { start: sastInstant(firstOfLast.getUTCFullYear(), firstOfLast.getUTCMonth() + 1, 1), end: sastInstant(firstOfThis.getUTCFullYear(), firstOfThis.getUTCMonth() + 1, 1) }, actorUserId: managerId });

    // ------------------------------------------------------------------ alerts from the real rules (leak, vacant use, tank low)
    const job = await runSmartUtilityJob(service, new Date());

    console.warn(`[client demo] org ${orgId}, property ${P}; charges ${lastCharges!.length}, draft invoices ${inv.invoices.length}, tenant statements ${tenantSt.created}, municipal pack ${JSON.stringify(pack).slice(0, 80)}; alerts ${JSON.stringify({ anomalies: job.anomalies, hybrid: job.hybridAlerts })}. Login: ${LOGIN_EMAIL} (password from DEMO_LOGIN_PASSWORD).`);
  }, 900_000);
});
