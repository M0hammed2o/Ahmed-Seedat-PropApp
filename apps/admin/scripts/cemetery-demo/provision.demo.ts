import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PRIVACY_VERSION, TERMS_VERSION } from '@propvault/config';

// ============================================================================================================
// CEMETERY + PROPERTY DEMO PROVISIONER (docs/CEMETERY_MANAGEMENT.md §Demo). IDEMPOTENT: every record is looked up by
// its natural key first and only created when missing, so re-running adds nothing (and fills in anything a previous
// interrupted run did not reach). One fictional organisation, "Proplyst Property & Cemetery Demo":
//   - Riverside Heights Apartments (12 residential units) and Northgate Business Centre (6 commercial units) with
//     fictional tenants, leases, six months of rent schedules, invoices and payments, and maintenance tickets;
//   - Greenfields Memorial Gardens: sections A/B/C x 40 grave sites, rights holders, sales with deposits and
//     instalments, reservations, withdrawn sites and burial records — all flagged as demonstration transactions.
// Safety:
//   - target must be the local stack, or production with CEMDEMO_CONFIRM_PRODUCTION=yes;
//   - refuses to adopt an existing account or organisation it did not create (login must be the org's principal);
//   - never re-passwords an existing account; a new account's password goes ONLY to CEMDEMO_CREDENTIALS_FILE
//     (a git-ignored *.local file), never to the console;
//   - tenants and grave-site contacts get no e-mail address a mailer could use (.invalid) and tenants no phone, so
//     no reminder, statement or WhatsApp can reach a real person; nothing here sends anything;
//   - touches only rows of the demo organisation (plus the demo login's own profile and consent rows).
//
//   CEMDEMO_SUPABASE_URL  CEMDEMO_SERVICE_ROLE_KEY  CEMDEMO_CREDENTIALS_FILE=/abs/path/.env.cemetery-demo.local
//   CEMDEMO_CONFIRM=seed-cemetery-demo  [CEMDEMO_LOGIN_EMAIL=cemetery.demo@proplyst.co.za]
//   [CEMDEMO_CONFIRM_PRODUCTION=yes]
//   npx vitest run -c vitest.demo.config.ts scripts/cemetery-demo/provision.demo.ts      (from apps/admin)
// ============================================================================================================

const PRODUCTION_URL = 'https://radqoboichldiucydrgy.supabase.co';
const LOCAL_URL = 'http://127.0.0.1:54321';
const URL_ = (process.env.CEMDEMO_SUPABASE_URL ?? '').replace(/\/+$/, '');
const SERVICE = process.env.CEMDEMO_SERVICE_ROLE_KEY ?? '';
const LOGIN_EMAIL = (process.env.CEMDEMO_LOGIN_EMAIL ?? 'cemetery.demo@proplyst.co.za').toLowerCase();
const CREDENTIALS_FILE = process.env.CEMDEMO_CREDENTIALS_FILE ?? '';
const IS_PROD = URL_ === PRODUCTION_URL;
const CONFIGURED = process.env.CEMDEMO_CONFIRM === 'seed-cemetery-demo';
const SAFE =
  CONFIGURED &&
  (URL_ === LOCAL_URL || (IS_PROD && process.env.CEMDEMO_CONFIRM_PRODUCTION === 'yes')) &&
  SERVICE.length > 20 &&
  /^[^@\s]+@[^@\s]+\.[a-z]+$/i.test(LOGIN_EMAIL) &&
  /\.local$/.test(CREDENTIALS_FILE);

export const ORG_NAME = 'Proplyst Property & Cemetery Demo';
const CEMETERY_NAME = 'Greenfields Memorial Gardens';

if (SAFE) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
}
for (const k of ['RESEND_API_KEY', 'RESEND_FROM_ADDRESS', 'WHATSAPP_ACCESS_TOKEN', 'PAYFAST_MERCHANT_ID', 'PAYFAST_MERCHANT_KEY']) {
  delete process.env[k];
}

const DAY = 86_400_000;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (isoDate: string, days: number) => iso(new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY));
function monthStart(offset: number, now = new Date()): string {
  return iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)));
}
/** Deterministic pseudo-random in [0, 1) so every run makes the same choices. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// ------------------------------------------------------------------------------------------------ fictional data
type PayProfile = 'paid' | 'current_overdue' | 'current_partial' | 'arrears_two' | 'late';
interface UnitSpec {
  label: string;
  beds?: number;
  sqm: number;
  rent: number;
  tenant?: string;
  leaseStart?: string;
  leaseMonths?: number;
  profile?: PayProfile;
}

const RESIDENTIAL: UnitSpec[] = [
  { label: 'Unit 101', beds: 1, sqm: 48, rent: 6800, tenant: 'Thandeka Mthembu', leaseStart: '2025-03-01', leaseMonths: 12, profile: 'paid' },
  { label: 'Unit 102', beds: 2, sqm: 72, rent: 9400, tenant: 'Johan and Elsa Pretorius', leaseStart: '2024-08-01', leaseMonths: 24, profile: 'late' },
  { label: 'Unit 103', beds: 2, sqm: 70, rent: 9200, tenant: 'Sibusiso Ngcobo', leaseStart: '2025-11-01', leaseMonths: 12, profile: 'current_overdue' },
  { label: 'Unit 104', beds: 1, sqm: 50, rent: 7100 },
  { label: 'Unit 105', beds: 3, sqm: 96, rent: 12900, tenant: 'Ravi and Anjali Govender', leaseStart: '2025-06-01', leaseMonths: 12, profile: 'paid' },
  { label: 'Unit 106', beds: 2, sqm: 74, rent: 9600, tenant: 'Karabo Molefe', leaseStart: '2026-02-01', leaseMonths: 12, profile: 'paid' },
  { label: 'Unit 201', beds: 1, sqm: 48, rent: 7000, tenant: 'Megan Fourie', leaseStart: '2025-09-01', leaseMonths: 12, profile: 'current_partial' },
  { label: 'Unit 202', beds: 2, sqm: 72, rent: 9500, tenant: 'Lwazi Zulu', leaseStart: '2025-01-01', leaseMonths: 24, profile: 'paid' },
  { label: 'Unit 203', beds: 2, sqm: 70, rent: 9300 },
  { label: 'Unit 204', beds: 3, sqm: 98, rent: 12500, tenant: 'Fatima Ebrahim', leaseStart: '2024-12-01', leaseMonths: 24, profile: 'paid' },
  { label: 'Unit 205', beds: 2, sqm: 74, rent: 9800, tenant: 'Pieter Botha', leaseStart: '2026-04-01', leaseMonths: 12, profile: 'paid' },
  { label: 'Unit 206', beds: 1, sqm: 52, rent: 7200 },
];

const COMMERCIAL: UnitSpec[] = [
  { label: 'Shop 1', sqm: 120, rent: 28500, tenant: 'Northgate Family Pharmacy (Pty) Ltd', leaseStart: '2024-07-01', leaseMonths: 36, profile: 'paid' },
  { label: 'Shop 2', sqm: 85, rent: 18500, tenant: 'Bean & Leaf Coffee Co. CC', leaseStart: '2025-02-01', leaseMonths: 36, profile: 'late' },
  { label: 'Suite 101', sqm: 140, rent: 24000, tenant: 'Khumalo & Partners Attorneys Inc.', leaseStart: '2024-04-01', leaseMonths: 60, profile: 'paid' },
  { label: 'Suite 102', sqm: 110, rent: 19800, tenant: 'Ubuntu Digital Solutions (Pty) Ltd', leaseStart: '2025-08-01', leaseMonths: 36, profile: 'current_overdue' },
  { label: 'Suite 201', sqm: 160, rent: 26500 },
  { label: 'Warehouse A', sqm: 420, rent: 42000, tenant: 'Coastline Logistics CC', leaseStart: '2024-10-01', leaseMonths: 36, profile: 'arrears_two' },
];

const MAINTENANCE: { property: 'res' | 'com'; unit: string | null; summary: string; description: string; priority: string; status: string; daysAgo: number }[] = [
  { property: 'res', unit: 'Unit 103', summary: 'Geyser leaking into ceiling', description: 'Tenant reports water dripping from the bathroom ceiling below the geyser.', priority: 'urgent', status: 'to_do', daysAgo: 1 },
  { property: 'res', unit: 'Unit 202', summary: 'Kitchen tap dripping', description: 'Mixer tap drips constantly; washer likely worn.', priority: 'low', status: 'in_progress', daysAgo: 6 },
  { property: 'res', unit: null, summary: 'Gate motor intermittent', description: 'Main vehicle gate sometimes fails to open with remotes.', priority: 'high', status: 'pending_approval', daysAgo: 9 },
  { property: 'res', unit: 'Unit 105', summary: 'Bedroom window latch broken', description: 'Main bedroom window will not lock.', priority: 'medium', status: 'completed', daysAgo: 24 },
  { property: 'res', unit: null, summary: 'Stairwell lights replaced', description: 'Two LED fittings on the 2nd-floor stairwell replaced.', priority: 'medium', status: 'completed', daysAgo: 41 },
  { property: 'com', unit: 'Warehouse A', summary: 'Roller door motor fault', description: 'Roller door stops halfway; tenant using manual chain.', priority: 'high', status: 'in_progress', daysAgo: 4 },
  { property: 'com', unit: 'Suite 101', summary: 'Air-conditioner service due', description: 'Annual service for the two split units.', priority: 'low', status: 'to_do', daysAgo: 3 },
  { property: 'com', unit: null, summary: 'Parking bay line marking', description: 'Repaint 24 parking bays and the loading-zone markings.', priority: 'medium', status: 'completed', daysAgo: 33 },
];

const PURCHASERS: { name: string; phone: string; address: string; nok?: [string, string, string] }[] = [
  { name: 'Priya Naidoo', phone: '031 555 0101', address: '14 Jacaranda Road, Hillcrest', nok: ['Kevin Naidoo', '031 555 0102', 'Son'] },
  { name: 'Themba Dlamini', phone: '031 555 0103', address: '7 Umthunzi Street, Pinetown', nok: ['Nomsa Dlamini', '031 555 0104', 'Wife'] },
  { name: 'Hendrik van Wyk', phone: '031 555 0105', address: '3 Protea Close, Kloof', nok: ['Annelie van Wyk', '031 555 0106', 'Daughter'] },
  { name: 'Zanele Khumalo', phone: '031 555 0107', address: '22 Ridge Road, Westville', nok: ['Mandla Khumalo', '031 555 0108', 'Brother'] },
  { name: 'Mohammed Cassim', phone: '031 555 0109', address: '9 Silverleaf Avenue, Westville', nok: ['Aisha Cassim', '031 555 0110', 'Wife'] },
  { name: 'Grace Mokoena', phone: '031 555 0111', address: '41 Old Main Road, Hillcrest', nok: ['Tumelo Mokoena', '031 555 0112', 'Son'] },
  { name: 'David Smith', phone: '031 555 0113', address: '18 Oak Lane, Gillitts' },
  { name: 'Nokuthula Mkhize', phone: '031 555 0114', address: '5 Ntombi Drive, Pinetown', nok: ['Sipho Mkhize', '031 555 0115', 'Husband'] },
  { name: 'Anand Pillay', phone: '031 555 0116', address: '30 Coronation Road, Pinetown', nok: ['Devi Pillay', '031 555 0117', 'Daughter'] },
  { name: 'Lerato Sithole', phone: '031 555 0118', address: '12 Kingfisher Way, Waterfall' },
  { name: "Margaret O'Brien", phone: '031 555 0119', address: '2 Chapel Street, Kloof', nok: ['Sean O\'Brien', '031 555 0120', 'Son'] },
  { name: 'Bongani Zungu', phone: '031 555 0121', address: '66 Inanda Road, Hillcrest' },
  { name: 'Shirley Govender', phone: '031 555 0122', address: '4 Mango Grove, Westville', nok: ['Ricky Govender', '031 555 0123', 'Son'] },
  { name: 'Jan Steyn', phone: '031 555 0124', address: '19 Bosveld Street, Kloof' },
  { name: 'Ayanda Ngubane', phone: '031 555 0125', address: '8 Isipingo Lane, Pinetown', nok: ['Zodwa Ngubane', '031 555 0126', 'Mother'] },
  { name: 'Fatima Moosa', phone: '031 555 0127', address: '27 Crescent Road, Westville' },
  { name: 'Peter Mahlangu', phone: '031 555 0128', address: '11 Valley View, Hillcrest', nok: ['Rose Mahlangu', '031 555 0129', 'Wife'] },
  { name: 'Charmaine Adams', phone: '031 555 0130', address: '5 Bluegum Avenue, Gillitts' },
  { name: 'Sanele Cele', phone: '031 555 0131', address: '73 St John\'s Avenue, Pinetown' },
  { name: 'Ruth Abrahams', phone: '031 555 0132', address: '16 Fairway Drive, Kloof', nok: ['Daniel Abrahams', '031 555 0133', 'Son'] },
  { name: 'Vusi Shabalala', phone: '031 555 0134', address: '20 Msinsi Road, Waterfall' },
  { name: 'Elizabeth Joubert', phone: '031 555 0135', address: '1 Hilltop Close, Hillcrest' },
  { name: 'Kumaran Reddy', phone: '031 555 0136', address: '38 Temple Road, Westville', nok: ['Lata Reddy', '031 555 0137', 'Wife'] },
  { name: 'Busisiwe Majola', phone: '031 555 0138', address: '9 Emberton Way, Pinetown' },
  { name: 'Simon Nkosi', phone: '031 555 0139', address: '44 Mountain Ridge, Kloof' },
  { name: 'Nadia Hendricks', phone: '031 555 0140', address: '6 Seaview Road, Westville' },
];

const DECEASED = [
  'Rajesh Naidoo', 'Sarah Naidoo', 'Elias Dlamini', 'Johanna van Wyk', 'Cornelius van Wyk', 'Bheki Khumalo',
  'Yusuf Cassim', 'Agnes Mokoena', 'Robert Smith', 'Mary Smith', 'Jabulani Mkhize', 'Saroja Pillay',
  'Patrick O\'Brien', 'Thokozani Zungu', 'Logan Govender', 'Maria Steyn', 'Dumisani Ngubane', 'Ismail Moosa',
  'Samuel Mahlangu', 'George Adams', 'Ntombi Cele', 'Isaac Abrahams', 'Phumzile Shabalala', 'Andries Joubert',
  'Gopal Reddy', 'Hannah Hendricks',
];

const SECTION_PLAN = {
  A: { price: 18500, sold: 30, reserved: [27, 33, 36], unavailable: { 19: 'Drainage easement along the eastern path', 40: 'Root zone of the heritage oak tree' }, occupied: 18, doubles: [21, 22, 23, 24], yearFrom: 2019 },
  B: { price: 14500, sold: 18, reserved: [21, 24, 29, 35], unavailable: { 12: 'Water main servitude', 31: 'Reserved for future pathway widening' }, occupied: 6, doubles: [] as number[], yearFrom: 2023 },
  C: { price: 11500, sold: 6, reserved: [9, 14, 22], unavailable: { 40: 'Boundary fence setback' }, occupied: 1, doubles: [] as number[], yearFrom: 2025 },
} as const;

// ------------------------------------------------------------------------------------------------ the provisioner
describe.skipIf(!CONFIGURED)('Cemetery + property demo provisioner (idempotent)', () => {
  it('ensures the fictional demo organisation, properties and cemetery exist exactly once', async () => {
    expect(SAFE, 'target must be the local stack, or production with CEMDEMO_CONFIRM_PRODUCTION=yes; key, e-mail or *.local credentials file missing').toBe(true);
    const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
    const created: Record<string, number> = {};
    const bump = (t: string) => (created[t] = (created[t] ?? 0) + 1);

    const must = async <T,>(label: string, p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> => {
      const { data, error } = await p;
      if (error) throw new Error(`${label}: ${error.message}`);
      return data;
    };
    /** Returns the id of the single row matching `match`, inserting `{...match, ...extra}` when there is none. */
    const ensure = async (table: string, match: Record<string, string | number | boolean | null>, extra: Record<string, unknown> = {}): Promise<string> => {
      let q = db.from(table).select('id');
      for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
      const found = await must(`${table} lookup`, q.limit(2));
      const rows = (found ?? []) as { id: string }[];
      if (rows.length > 1) throw new Error(`${table}: more than one row matches ${JSON.stringify(match)} — refusing to guess`);
      if (rows.length === 1) return rows[0]!.id;
      const row = await must(`${table} insert`, db.from(table).insert({ ...match, ...extra }).select('id').single());
      bump(table);
      return (row as { id: string }).id;
    };

    // ---------------------------------------------------------------- refusals before any write
    await must('migration 184 present', db.from('organizations').select('cemetery_enabled').limit(1));
    let userId: string | null = null;
    for (let page = 1; ; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      expect(error).toBeNull();
      const found = data.users.find((u) => u.email?.toLowerCase() === LOGIN_EMAIL);
      if (found) userId = found.id;
      if (data.users.length < 1000) break;
    }
    const orgs = (await must('org lookup', db.from('organizations').select('id, cemetery_enabled').eq('legal_name', ORG_NAME))) as { id: string }[];
    expect(orgs.length, 'more than one organisation carries the demo name — refusing').toBeLessThanOrEqual(1);
    let orgId = orgs[0]?.id ?? null;
    if (orgId && !userId) throw new Error('The demo organisation exists but the demo login does not — resolve by hand; refusing.');
    if (userId && !orgId) {
      // Resume after an interrupted first run: only a login THIS script created (metadata marker) that belongs to
      // no organisation at all may be picked up again. Anything else is someone's real account — refuse.
      const { data: u } = await db.auth.admin.getUserById(userId);
      const { count: memberships } = await db.from('organization_members').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      if (u.user?.user_metadata?.proplyst_demo !== 'cemetery' || (memberships ?? 0) > 0) {
        throw new Error('The demo login e-mail already belongs to an account outside the demo organisation — refusing to adopt it.');
      }
    }
    if (userId && orgId) {
      const { data: mem } = await db.from('organization_members').select('role, status').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
      expect(mem, 'the demo login is not the active principal of the demo organisation — refusing').toMatchObject({ role: 'principal', status: 'active' });
    }

    // ---------------------------------------------------------------- login, organisation, subscription
    if (!userId) {
      const password = `Cem-${randomBytes(18).toString('base64url')}`;
      const { data, error } = await db.auth.admin.createUser({
        email: LOGIN_EMAIL,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'Demo Manager', first_name: 'Demo', last_name: 'Manager', proplyst_demo: 'cemetery' },
      });
      if (error) throw new Error(`create login: ${error.message}`);
      userId = data.user!.id;
      bump('auth.users');
      const already = existsSync(CREDENTIALS_FILE) ? readFileSync(CREDENTIALS_FILE, 'utf8') : '';
      appendFileSync(
        CREDENTIALS_FILE,
        `${already && !already.endsWith('\n') ? '\n' : ''}# ${ORG_NAME} — ${IS_PROD ? 'PRODUCTION' : 'local'} login, created ${new Date().toISOString()}. Never commit or share.\n` +
          `CEMDEMO_${IS_PROD ? 'PROD' : 'LOCAL'}_EMAIL=${LOGIN_EMAIL}\nCEMDEMO_${IS_PROD ? 'PROD' : 'LOCAL'}_PASSWORD=${password}\n`,
      );
    }
    await must(
      'profile',
      db.from('profiles').update({ first_name: 'Demo', last_name: 'Manager', display_name: 'Demo Manager', profile_completed_at: new Date().toISOString() }).eq('id', userId).is('profile_completed_at', null),
    );
    // Same rows lib/legalConsent.ts recordLegalConsent() writes for a fictional login (precedent:
    // scripts/client-demo/production-safe.demo.ts), so the demo opens without the consent screen.
    await must(
      'legal consent',
      db.from('user_terms_acceptances').upsert(
        [
          { user_id: userId, document_type: 'terms_of_service', version: TERMS_VERSION },
          { user_id: userId, document_type: 'privacy_policy', version: PRIVACY_VERSION },
        ],
        { onConflict: 'user_id,document_type,version', ignoreDuplicates: true },
      ),
    );

    if (!orgId) {
      orgId = await ensure('organizations', { legal_name: ORG_NAME }, {
        trading_name: ORG_NAME,
        org_type: 'agency',
        status: 'active',
        cemetery_enabled: true,
        commercial_setup_completed_at: new Date().toISOString(),
        invoice_address: 'DEMO ADDRESS — 1 Memorial Way, Hillcrest, KwaZulu-Natal (fictional)',
        invoice_notes_default: 'Demonstration organisation: every person, property and amount on this document is fictional.',
      });
    }
    // The module switch for THIS organisation only (migration 184). Idempotent.
    await must('enable cemetery module', db.from('organizations').update({ cemetery_enabled: true }).eq('id', orgId).eq('legal_name', ORG_NAME));
    await ensure('organization_members', { org_id: orgId, user_id: userId }, { role: 'principal', status: 'active', joined_at: new Date().toISOString(), property_access_mode: 'all' });
    const { data: sub } = await db.from('organization_subscriptions').select('id').eq('org_id', orgId).limit(1);
    if (!sub?.length) {
      const plan = (await must('plan', db.from('plans').select('id').eq('code', 'business_annual').single())) as { id: string };
      const start = iso(new Date());
      await must('subscription', db.from('organization_subscriptions').insert({ org_id: orgId, plan_id: plan.id, billing_cycle: 'annual', current_period_start: start, current_period_end: addDays(start, 365), status: 'active' }));
      bump('organization_subscriptions'); // demo account: no PayFast contact, no payment method, nothing is charged
    }

    // ---------------------------------------------------------------- properties, units, tenants, leases, rent
    const today = iso(new Date());
    const months = [-5, -4, -3, -2, -1, 0].map((o) => monthStart(o));
    const r = rng(20261026);
    const seedProperty = async (key: 'res' | 'com', spec: { nickname: string; address: string; suburb: string; city: string; postal: string; type: string }, units: UnitSpec[]) => {
      const propertyId = await ensure('properties', { org_id: orgId, nickname: spec.nickname }, {
        address_line1: spec.address, suburb: spec.suburb, city: spec.city, province: 'KwaZulu-Natal', postal_code: spec.postal, property_type: spec.type,
        notes: 'Fictional demonstration property.', owner_user_id: userId,
      });
      const unitIds: Record<string, string> = {};
      for (const u of units) {
        const unitId = await ensure('units', { property_id: propertyId, unit_label: u.label }, { org_id: orgId, bedrooms: u.beds ?? null, size_sqm: u.sqm, market_rent: u.rent });
        unitIds[u.label] = unitId;
        if (!u.tenant) continue;
        const tenantId = await ensure('tenants', { org_id: orgId, full_name: u.tenant }, { status: 'active', email: null, phone: null, user_id: null });
        const end = addDays(iso(new Date(Date.UTC(Number(u.leaseStart!.slice(0, 4)), Number(u.leaseStart!.slice(5, 7)) - 1 + u.leaseMonths!, 1))), -1);
        const leaseEnd = end < today ? addDays(iso(new Date(Date.UTC(new Date().getUTCFullYear() + 1, Number(u.leaseStart!.slice(5, 7)) - 1, 1))), -1) : end; // renewed: keep active
        const leaseId = await ensure('leases', { unit_id: unitId, start_date: u.leaseStart! }, {
          org_id: orgId, end_date: leaseEnd, rent_amount: u.rent, rent_frequency: 'monthly', deposit_amount: key === 'res' ? u.rent * 1.5 : u.rent * 2, status: 'active', source: 'manual',
        });
        const { data: lt } = await db.from('lease_tenants').select('lease_id').eq('lease_id', leaseId).eq('tenant_id', tenantId).maybeSingle();
        if (!lt) {
          await must('lease_tenants', db.from('lease_tenants').insert({ lease_id: leaseId, tenant_id: tenantId, is_primary: true }));
          bump('lease_tenants');
        }
        for (const [i, month] of months.entries()) {
          if (month < u.leaseStart!) continue;
          const current = i === months.length - 1;
          const previous = i === months.length - 2;
          let status = 'paid';
          let paid = u.rent;
          let paidOn = addDays(month, 1 + Math.floor(r() * 4));
          if (u.profile === 'late') paidOn = addDays(month, 9 + Math.floor(r() * 5));
          if (current && u.profile === 'current_overdue') { status = 'overdue'; paid = 0; }
          if (current && u.profile === 'current_partial') { status = 'partial'; paid = Math.round(u.rent * 0.5); }
          if ((current || previous) && u.profile === 'arrears_two') { status = 'overdue'; paid = 0; }
          if (paidOn > today) paidOn = today;
          await ensure('rent_schedules', { lease_id: leaseId, due_date: month }, { org_id: orgId, amount: u.rent, status });
          const invoiceId = await ensure('invoices', { lease_id: leaseId, period: month }, {
            org_id: orgId, tenant_id: tenantId, amount: u.rent, status: 'issued', issued_at: `${addDays(month, -3)}T08:00:00Z`, source: 'rent_schedule',
            description: `Rent ${u.label} — ${new Date(`${month}T00:00:00Z`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`,
          });
          if (paid > 0) {
            await ensure('invoice_payments', { invoice_id: invoiceId, reference: `DEMO-RENT-${u.label.replace(/\s+/g, '')}-${month.slice(0, 7).replace('-', '')}` }, {
              org_id: orgId, tenant_id: tenantId, amount: paid, paid_at: paidOn, method: i % 3 === 0 ? 'debit_order' : 'eft', recorded_by: userId,
            });
          }
        }
      }
      for (const t of MAINTENANCE.filter((m) => m.property === key)) {
        const createdAt = new Date(Date.now() - t.daysAgo * DAY).toISOString();
        await ensure('maintenance_tickets', { property_id: propertyId, summary: t.summary }, {
          org_id: orgId, unit_id: t.unit ? unitIds[t.unit] : null, description: t.description, priority: t.priority, status: t.status,
          submitted_by_user_id: userId, created_at: createdAt, resolved_at: t.status === 'completed' ? new Date(Date.now() - (t.daysAgo - 3) * DAY).toISOString() : null,
        });
      }
      return propertyId;
    };
    await seedProperty('res', { nickname: 'Riverside Heights Apartments', address: '22 Riverside Road', suburb: 'Pinetown', city: 'Durban', postal: '3610', type: 'apartment_building' }, RESIDENTIAL);
    await seedProperty('com', { nickname: 'Northgate Business Centre', address: '8 Northgate Avenue', suburb: 'Westville', city: 'Durban', postal: '3629', type: 'commercial' }, COMMERCIAL);

    // ---------------------------------------------------------------- cemetery structure
    const cemeteryId = await ensure('cemeteries', { org_id: orgId, name: CEMETERY_NAME }, {
      address_line1: '1 Memorial Way', city: 'Hillcrest', province: 'KwaZulu-Natal', tenure_model: 'burial_rights', is_demo: true, created_by: userId,
      notes: 'Fictional demonstration cemetery. Schematic layout only.',
    });
    await must('demo flag', db.from('cemeteries').update({ is_demo: true }).eq('id', cemeteryId));
    const purchaserIds: string[] = [];
    for (const p of PURCHASERS) {
      purchaserIds.push(
        await ensure('cemetery_purchasers', { org_id: orgId, full_name: p.name }, {
          phone: p.phone, address: `${p.address} (fictional)`, email: `${p.name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@demo.proplyst.invalid`,
          next_of_kin_name: p.nok?.[0] ?? null, next_of_kin_phone: p.nok?.[1] ?? null, next_of_kin_relationship: p.nok?.[2] ?? null,
          notes: 'Fictional demonstration contact — never contact.', created_by: userId,
        }),
      );
    }

    let purchaserCursor = 0;
    let deceasedCursor = 0;
    const nextHolder = (code: string, n: number) => {
      // Family plots: some holders take adjacent sites (one purchaser, several graves).
      if (code === 'A' && (n === 12 || n === 22 || n === 24)) return purchaserIds[(purchaserCursor - 1 + purchaserIds.length) % purchaserIds.length]!;
      if (code === 'B' && (n === 4 || n === 5)) return purchaserIds[(purchaserCursor - 1 + purchaserIds.length) % purchaserIds.length]!;
      const id = purchaserIds[purchaserCursor % purchaserIds.length]!;
      purchaserCursor += 1;
      return id;
    };

    for (const [i, code] of (['A', 'B', 'C'] as const).entries()) {
      const plan = SECTION_PLAN[code];
      const sectionId = await ensure('cemetery_sections', { cemetery_id: cemeteryId, code }, {
        org_id: orgId, name: `Section ${code}`, sort_order: i, sites_per_row: 10,
        description: code === 'A' ? 'Original garden section beside the chapel' : code === 'B' ? 'Lawn section' : 'New lawn section (2025)',
      });
      const made = await must('generate sites', db.rpc('cemetery_generate_sites', { p_section_id: sectionId, p_count: 40, p_list_price: plan.price, p_length_m: 2.4, p_width_m: 1.2 }));
      created.cemetery_sites = (created.cemetery_sites ?? 0) + Number(made ?? 0);
      const sites = (await must('sites', db.from('cemetery_sites').select('id, site_number, reference, sale_status, burial_status, site_type').eq('section_id', sectionId).order('site_number'))) as {
        id: string; site_number: number; reference: string; sale_status: string; burial_status: string; site_type: string;
      }[];
      const bySite = new Map(sites.map((s) => [s.site_number, s]));

      // Site rules: double-depth graves and a cremation row in C.
      for (const n of plan.doubles) {
        const s = bySite.get(n)!;
        if (s.site_type !== 'double') await must('double site', db.from('cemetery_sites').update({ site_type: 'double', max_interments: 2, width_m: 1.4, list_price: plan.price + 6000 }).eq('id', s.id));
      }
      if (code === 'C') {
        for (const n of [36, 37, 38, 39]) {
          const s = bySite.get(n)!;
          if (s.site_type !== 'cremation') await must('cremation site', db.from('cemetery_sites').update({ site_type: 'cremation', length_m: 1, width_m: 1, list_price: 6500 }).eq('id', s.id));
        }
      }

      // Which numbers are sold: the first `sold` numbers that are not reserved or withdrawn.
      const withdrawn = plan.unavailable as Record<number, string>;
      const soldNumbers: number[] = [];
      for (let n = 1; n <= 40 && soldNumbers.length < plan.sold; n++) {
        if ((plan.reserved as readonly number[]).includes(n) || withdrawn[n]) continue;
        soldNumbers.push(n);
      }
      const occupiedNumbers = new Set(soldNumbers.filter((_, k) => k % Math.max(1, Math.floor(plan.sold / plan.occupied)) === 0).slice(0, plan.occupied));

      for (const [k, n] of soldNumbers.entries()) {
        const s = bySite.get(n)!;
        const { data: active } = await db.from('cemetery_sales').select('id, price, sale_date').eq('site_id', s.id).eq('status', 'active').maybeSingle();
        let saleId = active?.id as string | undefined;
        let price = Number(active?.price ?? 0);
        let saleDate = (active?.sale_date as string | undefined) ?? '';
        const holder = nextHolder(code, n);
        // About 20 of the 54 sales still owe money: most of section A is settled, B and C are newer.
        const owes = code === 'C' ? k % 2 === 0 : code === 'B' ? k % 3 !== 0 : k % 6 === 1;
        if (!saleId) {
          const year = plan.yearFrom + Math.floor((k / soldNumbers.length) * (new Date().getUTCFullYear() - plan.yearFrom + 1));
          saleDate = `${Math.min(year, new Date().getUTCFullYear())}-${pad(1 + Math.floor(r() * 12))}-${pad(1 + Math.floor(r() * 27))}`;
          if (saleDate > today) saleDate = addDays(today, -Math.floor(10 + r() * 60));
          const { data: siteNow } = await db.from('cemetery_sites').select('list_price').eq('id', s.id).single();
          price = Number(siteNow!.list_price) - (saleDate < '2024-01-01' ? 2500 : 0);
          const depositPct = owes ? [0.2, 0.3, 0.4][Math.floor(r() * 3)]! : [0.3, 0.4, 0.5, 1][Math.floor(r() * 4)]!;
          const result = (await must('record sale', db.rpc('cemetery_record_sale', {
            p_site_id: s.id, p_purchaser_id: holder, p_price: price, p_sale_date: saleDate,
            p_deposit: Math.round(price * depositPct), p_method: (['eft', 'card', 'cash', 'bank_transfer'] as const)[Math.floor(r() * 4)],
            p_reference: `DEMO-${s.reference}-1`, p_notes: 'Fictional demonstration sale.',
          }))) as { sale_id: string };
          saleId = result.sale_id;
          bump('cemetery_sales');
        }
        // Instalments: settled sales pay the rest; owing sales have paid part of it (or only the deposit).
        const { data: pays } = await db.from('cemetery_payments').select('amount, reference').eq('sale_id', saleId);
        const paidSoFar = (pays ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
        const refs = new Set((pays ?? []).map((p) => p.reference));
        const balance = Math.round((price - paidSoFar) * 100) / 100;
        if (balance > 0 && !refs.has(`DEMO-${s.reference}-2`)) {
          const amount = owes ? (k % 4 === 0 ? 0 : Math.round(balance * 0.35)) : balance;
          if (amount > 0) {
            let paidOn = addDays(saleDate, 30 + Math.floor(r() * 60));
            if (paidOn > today) paidOn = today;
            await must('instalment', db.rpc('cemetery_record_payment', { p_sale_id: saleId, p_amount: amount, p_paid_on: paidOn, p_method: 'eft', p_reference: `DEMO-${s.reference}-2`, p_notes: 'Fictional demonstration payment.' }));
            bump('cemetery_payments');
          }
        }
        if (occupiedNumbers.has(n)) {
          const interments = plan.doubles.includes(n as never) && n === 21 ? 2 : 1;
          for (let m = 1; m <= interments; m++) {
            const { data: existing } = await db.from('cemetery_burials').select('id').eq('site_id', s.id).eq('interment_number', m).maybeSingle();
            const name = DECEASED[deceasedCursor % DECEASED.length]!;
            deceasedCursor += 1;
            if (existing) continue;
            const burialDate = addDays(saleDate, 20 + Math.floor(r() * 400) + (m - 1) * 500);
            const bd = burialDate > today ? addDays(today, -5) : burialDate;
            await must('burial', db.rpc('cemetery_record_burial', {
              p_site_id: s.id, p_deceased_full_name: name, p_burial_date: bd, p_date_of_death: addDays(bd, -5),
              p_date_of_birth: `${1930 + Math.floor(r() * 50)}-${pad(1 + Math.floor(r() * 12))}-${pad(1 + Math.floor(r() * 27))}`,
              p_burial_order_number: `DEMO-BO-${s.reference}-${m}`, p_funeral_undertaker: ['Hillcrest Funeral Services (fictional)', 'Valley Memorial Undertakers (fictional)', 'Ubuntu Funeral Parlour (fictional)'][Math.floor(r() * 3)],
              p_notes: 'Fictional demonstration burial record.',
            }));
            bump('cemetery_burials');
          }
        }
      }

      for (const [k, n] of (plan.reserved as readonly number[]).entries()) {
        const s = bySite.get(n)!;
        if (s.sale_status !== 'available') continue;
        const holder = purchaserIds[(purchaserIds.length - 1 - k - i * 4 + purchaserIds.length) % purchaserIds.length]!;
        await must('reserve', db.rpc('cemetery_reserve_site', { p_site_id: s.id, p_purchaser_id: holder, p_reserved_until: addDays(today, 30 + k * 15), p_notes: 'Held pending family decision (fictional).' }));
        bump('reservations');
      }
      for (const [n, reason] of Object.entries(withdrawn)) {
        const s = bySite.get(Number(n))!;
        if (s.sale_status !== 'available') continue;
        await must('withdraw', db.rpc('cemetery_set_site_unavailable', { p_site_id: s.id, p_unavailable: true, p_reason: reason }));
        bump('withdrawn');
      }
    }

    // ---------------------------------------------------------------- summary (no secrets)
    const count = async (table: string) => {
      const { count: c, error } = await db.from(table).select('id', { count: 'exact', head: true }).eq('org_id', orgId);
      if (error) throw new Error(`count ${table}: ${error.message}`);
      return c ?? 0;
    };
    const summary = {
      target: IS_PROD ? 'PRODUCTION' : 'local',
      orgId,
      createdThisRun: created,
      totals: {
        properties: await count('properties'),
        units: await count('units'),
        tenants: await count('tenants'),
        leases: await count('leases'),
        invoices: await count('invoices'),
        maintenance: await count('maintenance_tickets'),
        graveSites: await count('cemetery_sites'),
        purchasers: await count('cemetery_purchasers'),
        sales: await count('cemetery_sales'),
        payments: await count('cemetery_payments'),
        burials: await count('cemetery_burials'),
      },
    };
    console.warn(`[cemetery demo] ${JSON.stringify(summary)} — login e-mail ${LOGIN_EMAIL}; password only in the credentials file.`);
    expect(summary.totals.graveSites).toBe(120);
  }, 900_000);
});
