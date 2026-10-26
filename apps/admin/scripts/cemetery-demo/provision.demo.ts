import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PRIVACY_VERSION, TERMS_VERSION } from '@propvault/config';
import {
  HISTORY_START,
  PROPERTIES,
  TICKETS,
  addDays,
  cemeteryPlan,
  dueDates,
  expenses,
  holders,
  listPrice,
  ref,
  rentPayments,
} from './plan';

// ============================================================================================================
// CEMETERY + PROPERTY DEMO PROVISIONER (docs/CEMETERY_MANAGEMENT.md §Demo). IDEMPOTENT: every step checks whether it
// has already happened (natural keys, payment references, site history) and only does what is missing, so re-running
// creates nothing and an interrupted run is completed, never duplicated.
//
// One fictional organisation, "Proplyst Property & Cemetery Demo", with a YEAR of history (1 Nov 2025 → 31 Oct 2026,
// never after today), defined as data in ./plan.ts:
//   - Riverside Heights Apartments (12 units) and Northgate Business Centre (6 units): leases, renewals, a tenant
//     change, vacancies, monthly rent invoices and payments, late payments, partial payments and arrears, monthly
//     operating expenses and repairs, maintenance tickets;
//   - Greenfields Memorial Gardens (A/B/C x 40 sites): an opening register captured at go-live, then monthly sales,
//     reservations (converted, lapsed and held), deposits, instalment plans, cancellations, withdrawn sites and burials.
//
// Everything goes through the SAME database functions the app uses, as the demo login, so the books reconcile:
//   rent: generate_rent_schedules_for_lease -> invoice_rent_schedule (journal on the due date) ->
//         record_invoice_payment (journal on the payment date) -> recompute_rent_schedule_status;
//   expenses: post_journal_entry on the expense date (record_expense() always posts "today");
//   cemetery: cemetery_* workflow functions with effective dates (chronology enforced by the database).
//
// Safety:
//   - target must be the local stack, or production with CEMDEMO_CONFIRM_PRODUCTION=yes;
//   - refuses to adopt an existing account or organisation it did not create (login must be the org's principal);
//   - never re-passwords an existing account; a new account's password goes ONLY to CEMDEMO_CREDENTIALS_FILE
//     (a git-ignored *.local file), never to the console. The seeder's own session comes from an admin magic-link
//     token (no e-mail is sent, the password is not used or changed);
//   - tenants have no e-mail or phone and grave-site contacts only .invalid addresses: no reminder, statement or
//     WhatsApp can reach a real person; nothing here sends anything;
//   - touches only rows of the demo organisation (plus the demo login's own profile and consent rows).
//
//   CEMDEMO_SUPABASE_URL  CEMDEMO_SERVICE_ROLE_KEY  CEMDEMO_ANON_KEY  CEMDEMO_CREDENTIALS_FILE=/abs/.env.cemetery-demo.local
//   CEMDEMO_CONFIRM=seed-cemetery-demo  [CEMDEMO_LOGIN_EMAIL=cemetery.demo@proplyst.co.za]  [CEMDEMO_CONFIRM_PRODUCTION=yes]
//   [CEMDEMO_EXPECT_NO_CHANGES=1: fail if this run creates anything — the idempotency check]
//   npx vitest run -c vitest.demo.config.ts scripts/cemetery-demo/provision.demo.ts      (from apps/admin)
// ============================================================================================================

const PRODUCTION_URL = 'https://radqoboichldiucydrgy.supabase.co';
const LOCAL_URL = 'http://127.0.0.1:54321';
const URL_ = (process.env.CEMDEMO_SUPABASE_URL ?? '').replace(/\/+$/, '');
const SERVICE = process.env.CEMDEMO_SERVICE_ROLE_KEY ?? '';
const ANON = process.env.CEMDEMO_ANON_KEY ?? '';
const LOGIN_EMAIL = (
  process.env.CEMDEMO_LOGIN_EMAIL ?? 'cemetery.demo@proplyst.co.za'
).toLowerCase();
const CREDENTIALS_FILE = process.env.CEMDEMO_CREDENTIALS_FILE ?? '';
const IS_PROD = URL_ === PRODUCTION_URL;
const CONFIGURED = process.env.CEMDEMO_CONFIRM === 'seed-cemetery-demo';
const SAFE =
  CONFIGURED &&
  (URL_ === LOCAL_URL || (IS_PROD && process.env.CEMDEMO_CONFIRM_PRODUCTION === 'yes')) &&
  SERVICE.length > 20 &&
  ANON.length > 20 &&
  /^[^@\s]+@[^@\s]+\.[a-z]+$/i.test(LOGIN_EMAIL) &&
  /\.local$/.test(CREDENTIALS_FILE);

export const ORG_NAME = 'Proplyst Property & Cemetery Demo';
const CEMETERY_NAME = 'Greenfields Memorial Gardens';

for (const k of [
  'RESEND_API_KEY',
  'RESEND_FROM_ADDRESS',
  'WHATSAPP_ACCESS_TOKEN',
  'PAYFAST_MERCHANT_ID',
  'PAYFAST_MERCHANT_KEY',
]) {
  delete process.env[k];
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
/** Today's business date in South Africa (UTC+2). */
const sastToday = () => new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);

describe.skipIf(!CONFIGURED)(
  'Cemetery + property demo provisioner (idempotent, one year of history)',
  () => {
    it('ensures the fictional demo organisation and its year of operations exist exactly once', async () => {
      expect(
        SAFE,
        'target must be the local stack, or production with CEMDEMO_CONFIRM_PRODUCTION=yes; keys, e-mail or *.local credentials file missing',
      ).toBe(true);
      const db: SupabaseClient = createClient(URL_, SERVICE, opts);
      const today = sastToday();
      const created: Record<string, number> = {};
      const bump = (t: string, n = 1) => (created[t] = (created[t] ?? 0) + n);

      const must = async <T>(
        label: string,
        p: PromiseLike<{ data: T; error: { message: string } | null }>,
      ): Promise<T> => {
        const { data, error } = await p;
        if (error) throw new Error(`${label}: ${error.message}`);
        return data;
      };
      /** Returns the id of the single row matching `match`, inserting `{...match, ...extra}` when there is none. */
      const ensure = async (
        table: string,
        match: Record<string, string | number | boolean | null>,
        extra: Record<string, unknown> = {},
      ): Promise<string> => {
        let q = db.from(table).select('id');
        for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
        const rows = ((await must(`${table} lookup`, q.limit(2))) ?? []) as { id: string }[];
        if (rows.length > 1)
          throw new Error(
            `${table}: more than one row matches ${JSON.stringify(match)} — refusing to guess`,
          );
        if (rows.length === 1) return rows[0]!.id;
        const row = await must(
          `${table} insert`,
          db
            .from(table)
            .insert({ ...match, ...extra })
            .select('id')
            .single(),
        );
        bump(table);
        return (row as { id: string }).id;
      };

      // ---------------------------------------------------------------- refusals before any write
      await must(
        'migrations 184/185 present',
        db.from('cemetery_site_events').select('id').limit(1),
      );
      let userId: string | null = null;
      for (let page = 1; ; page++) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
        expect(error).toBeNull();
        const found = data.users.find((u) => u.email?.toLowerCase() === LOGIN_EMAIL);
        if (found) userId = found.id;
        if (data.users.length < 1000) break;
      }
      const orgs = (await must(
        'org lookup',
        db.from('organizations').select('id').eq('legal_name', ORG_NAME),
      )) as { id: string }[];
      expect(
        orgs.length,
        'more than one organisation carries the demo name — refusing',
      ).toBeLessThanOrEqual(1);
      let orgId = orgs[0]?.id ?? null;
      if (orgId && !userId)
        throw new Error(
          'The demo organisation exists but the demo login does not — resolve by hand; refusing.',
        );
      if (userId && !orgId) {
        // Resume after an interrupted first run: only a login THIS script created (metadata marker) that belongs to
        // no organisation at all may be picked up again. Anything else is someone's real account — refuse.
        const { data: u } = await db.auth.admin.getUserById(userId);
        const { count: memberships } = await db
          .from('organization_members')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId);
        if (u.user?.user_metadata?.proplyst_demo !== 'cemetery' || (memberships ?? 0) > 0) {
          throw new Error(
            'The demo login e-mail already belongs to an account outside the demo organisation — refusing to adopt it.',
          );
        }
      }
      if (userId && orgId) {
        const { data: mem } = await db
          .from('organization_members')
          .select('role, status')
          .eq('org_id', orgId)
          .eq('user_id', userId)
          .maybeSingle();
        expect(
          mem,
          'the demo login is not the active principal of the demo organisation — refusing',
        ).toMatchObject({ role: 'principal', status: 'active' });
      }

      // ---------------------------------------------------------------- login, organisation, subscription, ledger
      if (!userId) {
        const password = `Cem-${randomBytes(18).toString('base64url')}`;
        const { data, error } = await db.auth.admin.createUser({
          email: LOGIN_EMAIL,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: 'Demo Manager',
            first_name: 'Demo',
            last_name: 'Manager',
            proplyst_demo: 'cemetery',
          },
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
        db
          .from('profiles')
          .update({
            first_name: 'Demo',
            last_name: 'Manager',
            display_name: 'Demo Manager',
            profile_completed_at: new Date().toISOString(),
          })
          .eq('id', userId)
          .is('profile_completed_at', null),
      );
      // Same rows lib/legalConsent.ts recordLegalConsent() writes (precedent: scripts/client-demo/production-safe.demo.ts).
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
        orgId = await ensure(
          'organizations',
          { legal_name: ORG_NAME },
          {
            trading_name: ORG_NAME,
            org_type: 'agency',
            status: 'active',
            cemetery_enabled: true,
            commercial_setup_completed_at: new Date().toISOString(),
            invoice_address: 'DEMO ADDRESS — 1 Memorial Way, Hillcrest, KwaZulu-Natal (fictional)',
            invoice_notes_default:
              'Demonstration organisation: every person, property and amount on this document is fictional.',
          },
        );
      }
      // The module switch for THIS organisation only (migration 184). Idempotent.
      await must(
        'enable cemetery module',
        db
          .from('organizations')
          .update({ cemetery_enabled: true })
          .eq('id', orgId)
          .eq('legal_name', ORG_NAME),
      );
      await ensure(
        'organization_members',
        { org_id: orgId, user_id: userId },
        {
          role: 'principal',
          status: 'active',
          joined_at: new Date().toISOString(),
          property_access_mode: 'all',
        },
      );
      const { data: sub } = await db
        .from('organization_subscriptions')
        .select('id')
        .eq('org_id', orgId)
        .limit(1);
      if (!sub?.length) {
        const plan = (await must(
          'plan',
          db.from('plans').select('id').eq('code', 'business_annual').single(),
        )) as { id: string };
        await must(
          'subscription',
          db.from('organization_subscriptions').insert({
            org_id: orgId,
            plan_id: plan.id,
            billing_cycle: 'annual',
            current_period_start: today,
            current_period_end: addDays(today, 365),
            status: 'active',
          }),
        );
        bump('organization_subscriptions'); // demo account: no PayFast contact, no payment method, nothing is charged
      }
      // create_organization() seeds the chart of accounts; an organisation created directly must get it too.
      const { count: coa } = await db
        .from('chart_of_accounts')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId);
      if (!coa) {
        await must('chart of accounts', db.rpc('seed_chart_of_accounts', { p_org_id: orgId }));
        bump('chart_of_accounts');
      }
      // An organisation that has used Proplyst for a year has long finished first-use onboarding: no getting-started
      // checklist and no product tour in the demo (this organisation's own onboarding row only).
      {
        const since = `${HISTORY_START}T09:00:00+02:00`;
        const keys = [
          'staff_step_skipped_at',
          'viewed_payments_intro_at',
          'viewed_documents_intro_at',
          'walkthrough_completed_at',
        ];
        const { data: ob } = await db
          .from('organization_onboarding_state')
          .select('*')
          .eq('org_id', orgId)
          .maybeSingle();
        const fill = Object.fromEntries(
          keys.filter((k) => !(ob as Record<string, unknown> | null)?.[k]).map((k) => [k, since]),
        );
        if (!ob) {
          await must(
            'onboarding',
            db.from('organization_onboarding_state').insert({ org_id: orgId, ...fill }),
          );
          bump('organization_onboarding_state');
        } else if (Object.keys(fill).length) {
          await must(
            'onboarding',
            db.from('organization_onboarding_state').update(fill).eq('org_id', orgId),
          );
          bump('organization_onboarding_state');
        }
      }
      const accounts = (await must(
        'accounts',
        db.from('chart_of_accounts').select('id, code, name').eq('org_id', orgId),
      )) as { id: string; code: string; name: string }[];
      const account = (code: string) => accounts.find((a) => a.code === code)!.id;

      // The seeder acts as the demo login (accounting functions require a signed-in accountant+).
      const { data: link, error: linkError } = await db.auth.admin.generateLink({
        type: 'magiclink',
        email: LOGIN_EMAIL,
      });
      if (linkError || !link.properties) throw new Error(`session link: ${linkError?.message}`);
      const user: SupabaseClient = createClient(URL_, ANON, opts);
      {
        const { error } = await user.auth.verifyOtp({
          token_hash: link.properties.hashed_token,
          type: 'magiclink',
        });
        if (error) throw new Error(`session: ${error.message}`);
      }
      const call = async <T = unknown>(
        client: SupabaseClient,
        fn: string,
        args: Record<string, unknown>,
      ): Promise<T> => {
        const { data, error } = await client.rpc(fn, args);
        if (error)
          throw new Error(`${fn}(${JSON.stringify(args).slice(0, 160)}): ${error.message}`);
        return data as T;
      };

      // ---------------------------------------------------------------- properties, units, leases, rent, payments
      const propertyId: Record<'res' | 'com', string> = { res: '', com: '' };
      const unitIds: Record<string, string> = {};
      for (const p of PROPERTIES) {
        propertyId[p.key] = await ensure(
          'properties',
          { org_id: orgId, nickname: p.nickname },
          {
            address_line1: p.address,
            suburb: p.suburb,
            city: p.city,
            province: 'KwaZulu-Natal',
            postal_code: p.postal,
            property_type: p.type,
            notes: 'Fictional demonstration property.',
            owner_user_id: userId,
            estimated_value: p.key === 'res' ? 18_500_000 : 32_000_000,
            estimated_value_as_of: '2026-07-01',
            estimated_value_updated_by: userId,
          },
        );
        await must(
          'valuation',
          db
            .from('properties')
            .update({
              estimated_value: p.key === 'res' ? 18_500_000 : 32_000_000,
              estimated_value_as_of: '2026-07-01',
            })
            .eq('id', propertyId[p.key])
            .is('estimated_value', null),
        );
        for (const u of p.units) {
          const unitId = await ensure(
            'units',
            { property_id: propertyId[p.key], unit_label: u.label },
            { org_id: orgId, bedrooms: u.beds ?? null, size_sqm: u.sqm, market_rent: u.marketRent },
          );
          unitIds[`${p.key}:${u.label}`] = unitId;
          for (const t of u.tenancies) {
            const tenantId = await ensure(
              'tenants',
              { org_id: orgId, full_name: t.tenant },
              { status: 'active', email: null, phone: null, user_id: null },
            );
            const leaseId = await ensure(
              'leases',
              { unit_id: unitId, start_date: t.start },
              {
                org_id: orgId,
                end_date: t.end,
                rent_amount: t.rent,
                rent_frequency: 'monthly',
                deposit_amount: p.key === 'res' ? t.rent * 1.5 : t.rent * 2,
                status: 'active',
                source: 'manual',
                rent_tracking_start_date: t.start < HISTORY_START ? HISTORY_START : t.start,
              },
            );
            const { data: lt } = await db
              .from('lease_tenants')
              .select('lease_id')
              .eq('lease_id', leaseId)
              .eq('tenant_id', tenantId)
              .maybeSingle();
            if (!lt) {
              await must(
                'lease_tenants',
                db
                  .from('lease_tenants')
                  .insert({ lease_id: leaseId, tenant_id: tenantId, is_primary: true }),
              );
              bump('lease_tenants');
            }
            const { data: lease } = await db
              .from('leases')
              .select('status')
              .eq('id', leaseId)
              .single();
            const due = dueDates(t, today);
            if (lease!.status === 'active' && due.length) {
              bump(
                'rent_schedules',
                await call<number>(db, 'generate_rent_schedules_for_lease', {
                  p_lease_id: leaseId,
                  p_through: due[due.length - 1],
                }),
              );
            }
            // Invoice every pending schedule through the app's own function (journal dated on the due date).
            const pending = (await must(
              'pending schedules',
              db
                .from('rent_schedules')
                .select('id, due_date')
                .eq('lease_id', leaseId)
                .eq('status', 'pending')
                .lte('due_date', today)
                .order('due_date'),
            )) as { id: string; due_date: string }[];
            for (const s of pending) {
              const invoiceId = await call<string>(user, 'invoice_rent_schedule', {
                p_rent_schedule_id: s.id,
              });
              const label = new Date(`${s.due_date}T00:00:00Z`).toLocaleDateString('en-ZA', {
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              });
              await must(
                'invoice dates',
                db
                  .from('invoices')
                  .update({
                    issued_at: `${addDays(s.due_date, -3)}T08:00:00+02:00`,
                    description: `Rent ${u.label} — ${label}`,
                  })
                  .eq('id', invoiceId),
              );
              bump('invoices');
            }
            const invoices = (await must(
              'invoices',
              db.from('invoices').select('id, period').eq('lease_id', leaseId),
            )) as { id: string; period: string }[];
            const invoiceFor = new Map(invoices.map((i) => [i.period, i.id]));
            const paidRefs = new Set(
              (
                (await must(
                  'payment refs',
                  db
                    .from('invoice_payments')
                    .select('reference')
                    .in(
                      'invoice_id',
                      invoices.map((i) => i.id).concat('00000000-0000-0000-0000-000000000000'),
                    ),
                )) as { reference: string }[]
              ).map((x) => x.reference),
            );
            for (const pay of rentPayments(u.label, t, today)) {
              if (paidRefs.has(pay.reference)) continue;
              const invoiceId = invoiceFor.get(pay.dueDate);
              if (!invoiceId) throw new Error(`no invoice for ${u.label} ${pay.dueDate}`);
              await call(user, 'record_invoice_payment', {
                p_invoice_id: invoiceId,
                p_amount: pay.amount,
                p_paid_at: pay.paidOn,
                p_method: pay.method,
                p_reference: pay.reference,
                p_notes: 'Fictional demonstration payment',
              });
              bump('invoice_payments');
            }
            // Unpaid past-due rent becomes overdue (same function the payment path uses).
            const open = (await must(
              'open schedules',
              db
                .from('rent_schedules')
                .select('id')
                .eq('lease_id', leaseId)
                .eq('status', 'invoiced')
                .lt('due_date', today),
            )) as { id: string }[];
            for (const s of open)
              await call(db, 'recompute_rent_schedule_status', { p_rent_schedule_id: s.id });
            // Leases that ended in the year: renewed (expired) or ended early (terminated). The unit's occupancy follows.
            if (t.final !== 'active' && lease!.status === 'active') {
              await must(
                'lease end',
                db.from('leases').update({ status: t.final }).eq('id', leaseId),
              );
              bump('leases_ended');
            }
          }
          // A tenant with no active lease left has moved out.
          for (const t of u.tenancies) {
            const stillActive = u.tenancies.some(
              (x) => x.tenant === t.tenant && x.final === 'active',
            );
            if (!stillActive)
              await must(
                'tenant moved out',
                db
                  .from('tenants')
                  .update({ status: 'expired' })
                  .eq('org_id', orgId)
                  .eq('full_name', t.tenant)
                  .neq('status', 'expired'),
              );
          }
        }
      }

      // ---------------------------------------------------------------- operating expenses (journals on the expense date)
      for (const e of expenses(today)) {
        const expenseId = await ensure(
          'expenses',
          { property_id: propertyId[e.property], reference_number: e.reference },
          {
            org_id: orgId,
            category: e.category,
            category_code: e.categoryCode,
            amount: e.amount,
            status: 'pending',
            invoice_date: e.date,
            created_at: `${e.date}T09:00:00+02:00`,
            notes: e.notes,
          },
        );
        const { data: row } = await db
          .from('expenses')
          .select('status')
          .eq('id', expenseId)
          .single();
        if (row!.status !== 'pending') continue;
        // Same account choice as record_expense(): "<category> Expense" if it exists, else Other Expense (5900); paid
        // from the business bank account (1000).
        const expenseAccount =
          accounts.find((a) => a.name.toLowerCase() === `${e.category} expense`.toLowerCase())
            ?.id ?? account('5900');
        const journal = await call<string>(user, 'post_journal_entry', {
          p_org_id: orgId,
          p_entry_date: e.date,
          p_description: `Expense: ${e.category}`,
          p_source_type: 'expense',
          p_source_id: expenseId,
          p_lines: [
            { account_id: expenseAccount, debit: e.amount, property_id: propertyId[e.property] },
            { account_id: account('1000'), credit: e.amount, property_id: propertyId[e.property] },
          ],
        });
        await must(
          'expense recorded',
          db
            .from('expenses')
            .update({ status: 'recorded', journal_entry_id: journal })
            .eq('id', expenseId),
        );
        bump('expense_journals');
      }

      // ---------------------------------------------------------------- maintenance tickets
      for (const t of TICKETS) {
        if (t.opened > today) continue;
        await ensure(
          'maintenance_tickets',
          { property_id: propertyId[t.property], summary: t.summary },
          {
            org_id: orgId,
            unit_id: t.unit ? unitIds[`${t.property}:${t.unit}`] : null,
            description: t.description,
            priority: t.priority,
            status: t.status,
            submitted_by_user_id: userId,
            created_at: `${t.opened}T10:00:00+02:00`,
            resolved_at: t.resolved ? `${t.resolved}T15:00:00+02:00` : null,
          },
        );
      }

      // ---------------------------------------------------------------- cemetery structure and rights holders
      const cemeteryId = await ensure(
        'cemeteries',
        { org_id: orgId, name: CEMETERY_NAME },
        {
          address_line1: '1 Memorial Way',
          city: 'Hillcrest',
          province: 'KwaZulu-Natal',
          tenure_model: 'burial_rights',
          is_demo: true,
          created_by: userId,
          notes: 'Fictional demonstration cemetery. Schematic layout only.',
        },
      );
      await must(
        'demo flag',
        db.from('cemeteries').update({ is_demo: true }).eq('id', cemeteryId).eq('is_demo', false),
      );
      const plan = cemeteryPlan(today);
      for (const [i, code] of (['A', 'B', 'C'] as const).entries()) {
        const sectionId = await ensure(
          'cemetery_sections',
          { cemetery_id: cemeteryId, code },
          {
            org_id: orgId,
            name: `Section ${code}`,
            sort_order: i,
            sites_per_row: 10,
            description:
              code === 'A'
                ? 'Original garden section beside the chapel'
                : code === 'B'
                  ? 'Lawn section'
                  : 'New lawn section',
          },
        );
        bump(
          'cemetery_sites',
          await call<number>(user, 'cemetery_generate_sites', {
            p_section_id: sectionId,
            p_count: 40,
            p_list_price: listPrice(`${code}-001`, today),
            p_length_m: 2.4,
            p_width_m: 1.2,
          }),
        );
      }
      const siteRows = (await must(
        'sites',
        db
          .from('cemetery_sites')
          .select('id, reference, site_type, sale_status')
          .eq('cemetery_id', cemeteryId),
      )) as { id: string; reference: string; site_type: string; sale_status: string }[];
      const siteId = new Map(siteRows.map((s) => [s.reference, s.id]));
      for (const s of plan.doubleSites) {
        if (siteRows.find((x) => x.reference === s)!.site_type !== 'double')
          await must(
            'double site',
            db
              .from('cemetery_sites')
              .update({
                site_type: 'double',
                max_interments: 2,
                width_m: 1.4,
                list_price: listPrice(s, today),
              })
              .eq('id', siteId.get(s)!),
          );
      }
      for (const s of plan.cremationSites) {
        if (siteRows.find((x) => x.reference === s)!.site_type !== 'cremation')
          await must(
            'cremation site',
            db
              .from('cemetery_sites')
              .update({
                site_type: 'cremation',
                length_m: 1,
                width_m: 1,
                list_price: listPrice(s, today),
              })
              .eq('id', siteId.get(s)!),
          );
      }
      const holderId = new Map<string, string>();
      for (const h of holders()) {
        holderId.set(
          h.name,
          await ensure(
            'cemetery_purchasers',
            { org_id: orgId, full_name: h.name },
            {
              phone: h.phone,
              email: h.email,
              address: h.address,
              next_of_kin_name: h.nok?.[0] ?? null,
              next_of_kin_phone: h.nok?.[1] ?? null,
              next_of_kin_relationship: h.nok?.[2] ?? null,
              notes: 'Fictional demonstration contact — never contact.',
              created_by: userId,
            },
          ),
        );
      }

      // ---------------------------------------------------------------- cemetery timeline (chronological replay)
      const existingSales = (await must(
        'sales',
        db
          .from('cemetery_sales')
          .select('id, site_id, sale_date, status')
          .eq('cemetery_id', cemeteryId),
      )) as { id: string; site_id: string; sale_date: string; status: string }[];
      const refBySite = new Map([...siteId].map(([r, id]) => [id, r]));
      const saleId = new Map(
        existingSales.map((s) => [`${refBySite.get(s.site_id)}@${s.sale_date}`, s.id]),
      );
      const saleStatus = new Map(existingSales.map((s) => [s.id, s.status]));
      const events = new Set(
        (
          (await must(
            'events',
            db
              .from('cemetery_site_events')
              .select('site_id, event_type, event_date')
              .eq('org_id', orgId),
          )) as { site_id: string; event_type: string; event_date: string }[]
        ).map((e) => `${e.site_id}|${e.event_type}|${e.event_date}`),
      );
      const paid = new Set(
        (
          (await must(
            'payments',
            db.from('cemetery_payments').select('sale_id, reference').eq('org_id', orgId),
          )) as { sale_id: string; reference: string }[]
        ).map((p) => `${p.sale_id}|${p.reference}`),
      );
      const buried = new Set(
        (
          (await must(
            'burials',
            db.from('cemetery_burials').select('site_id, interment_number').eq('org_id', orgId),
          )) as { site_id: string; interment_number: number }[]
        ).map((b) => `${b.site_id}|${b.interment_number}`),
      );
      const has = (site: string, type: string, date: string) =>
        events.has(`${siteId.get(site)}|${type}|${date}`);
      let burialOrder = 0;
      for (const a of plan.acts) {
        if (a.k === 'withdraw' && !has(a.site, 'withdrawn', a.date)) {
          await call(user, 'cemetery_set_site_unavailable', {
            p_site_id: siteId.get(a.site),
            p_unavailable: true,
            p_reason: a.reason,
            p_effective_on: a.date,
          });
          bump('cemetery_withdrawn');
        } else if (a.k === 'return' && !has(a.site, 'returned_to_sale', a.date)) {
          await call(user, 'cemetery_set_site_unavailable', {
            p_site_id: siteId.get(a.site),
            p_unavailable: false,
            p_effective_on: a.date,
          });
          bump('cemetery_returned');
        } else if (a.k === 'reserve' && !has(a.site, 'reserved', a.date)) {
          await call(user, 'cemetery_reserve_site', {
            p_site_id: siteId.get(a.site),
            p_purchaser_id: holderId.get(a.holder),
            p_reserved_until: a.until,
            p_notes: `${a.notes} (fictional)`,
            p_reserved_on: a.date,
          });
          bump('cemetery_reservations');
        } else if (a.k === 'release' && !has(a.site, 'reservation_released', a.date)) {
          await call(user, 'cemetery_release_reservation', {
            p_site_id: siteId.get(a.site),
            p_released_on: a.date,
          });
          bump('cemetery_releases');
        } else if (a.k === 'sale' && !saleId.has(a.key)) {
          const res = await call<{ sale_id: string }>(user, 'cemetery_record_sale', {
            p_site_id: siteId.get(a.site),
            p_purchaser_id: holderId.get(a.holder),
            p_price: a.price,
            p_sale_date: a.date,
            p_deposit: a.deposit,
            p_method: a.method,
            p_reference: ref(a.site, 1),
            p_notes:
              a.date < HISTORY_START
                ? 'Opening register: captured when the cemetery started using Proplyst (fictional).'
                : 'Fictional demonstration sale.',
          });
          saleId.set(a.key, res.sale_id);
          saleStatus.set(res.sale_id, 'active');
          paid.add(`${res.sale_id}|${ref(a.site, 1)}`);
          bump('cemetery_sales');
        } else if (a.k === 'pay') {
          const id = saleId.get(a.key)!;
          if (!paid.has(`${id}|${a.ref}`)) {
            await call(user, 'cemetery_record_payment', {
              p_sale_id: id,
              p_amount: a.amount,
              p_paid_on: a.date,
              p_method: a.method,
              p_reference: a.ref,
              p_notes: 'Fictional demonstration payment.',
            });
            paid.add(`${id}|${a.ref}`);
            bump('cemetery_payments');
          }
        } else if (a.k === 'cancel') {
          const id = saleId.get(a.key)!;
          if (saleStatus.get(id) === 'active') {
            await call(user, 'cemetery_cancel_sale', {
              p_sale_id: id,
              p_reason: `${a.reason} (fictional)`,
              p_cancelled_on: a.date,
            });
            saleStatus.set(id, 'cancelled');
            bump('cemetery_cancellations');
          }
        } else if (a.k === 'burial') {
          burialOrder += 1;
          if (!buried.has(`${siteId.get(a.site)}|${a.n}`)) {
            await call(user, 'cemetery_record_burial', {
              p_site_id: siteId.get(a.site),
              p_deceased_full_name: a.name,
              p_burial_date: a.date,
              p_date_of_death: a.dod,
              p_date_of_birth: a.dob,
              p_burial_order_number: `DEMO-BO-${String(burialOrder).padStart(4, '0')}`,
              p_funeral_undertaker: a.undertaker,
              p_notes: 'Fictional demonstration burial record.',
            });
            bump('cemetery_burials');
          }
        }
      }
      // Current tariff on sites still for sale (list prices rise each 1 July).
      const forSale = (await must(
        'sites for sale',
        db
          .from('cemetery_sites')
          .select('id, reference, list_price')
          .eq('cemetery_id', cemeteryId)
          .in('sale_status', ['available', 'reserved']),
      )) as { id: string; reference: string; list_price: number | null }[];
      for (const s of forSale) {
        const price = listPrice(s.reference, today);
        if (Number(s.list_price) !== price)
          await must(
            'list price',
            db.from('cemetery_sites').update({ list_price: price }).eq('id', s.id),
          );
      }

      // ---------------------------------------------------------------- reconciliation (the books must agree)
      const sumOf = (
        rows: { amount?: number; debit?: number; credit?: number }[],
        k: 'amount' | 'debit' | 'credit',
      ) => Math.round(rows.reduce((a, r) => a + Number(r[k] ?? 0), 0) * 100) / 100;
      const journals = (await must(
        'journals',
        db
          .from('journal_entries')
          .select('source_type, journal_lines(account_id, debit, credit)')
          .eq('org_id', orgId),
      )) as {
        source_type: string;
        journal_lines: { account_id: string; debit: number; credit: number }[];
      }[];
      const linesOf = (type: string, accountCode: string, side: 'debit' | 'credit') =>
        sumOf(
          journals
            .filter((j) => j.source_type === type)
            .flatMap((j) => j.journal_lines)
            .filter((l) => l.account_id === account(accountCode)),
          side,
        );
      const invoices = (await must(
        'all invoices',
        db.from('invoices').select('amount').eq('org_id', orgId),
      )) as { amount: number }[];
      const rentPaid = (await must(
        'all rent payments',
        db.from('invoice_payments').select('amount').eq('org_id', orgId).is('reversed_at', null),
      )) as { amount: number }[];
      const exp = (await must(
        'all expenses',
        db.from('expenses').select('amount, status').eq('org_id', orgId),
      )) as { amount: number; status: string }[];
      const balances = (await must(
        'cemetery balances',
        db
          .from('cemetery_sale_balances')
          .select('price, amount_paid, balance_due, status')
          .eq('org_id', orgId),
      )) as { price: number; amount_paid: number; balance_due: number; status: string }[];
      const cemPaid = (await must(
        'cemetery payments',
        db.from('cemetery_payments').select('amount').eq('org_id', orgId),
      )) as { amount: number }[];
      const reconciliation = {
        rentInvoiced: sumOf(invoices, 'amount'),
        rentInvoiceJournalsAR: linesOf('rent_invoice', '1100', 'debit'),
        rentReceived: sumOf(rentPaid, 'amount'),
        rentPaymentJournalsBank: linesOf('payment', '1000', 'debit'),
        expensesRecorded: sumOf(
          exp.filter((e) => e.status === 'recorded'),
          'amount',
        ),
        expenseJournalsBank: linesOf('expense', '1000', 'credit'),
        cemeteryPaymentsTotal: sumOf(cemPaid, 'amount'),
        cemeteryPaidPerSales: sumOf(
          balances.map((b) => ({ amount: b.amount_paid })),
          'amount',
        ),
        cemeteryActiveValue: sumOf(
          balances.filter((b) => b.status === 'active').map((b) => ({ amount: b.price })),
          'amount',
        ),
        cemeteryOutstanding: sumOf(
          balances.map((b) => ({ amount: b.balance_due })),
          'amount',
        ),
      };
      expect(reconciliation.rentInvoiceJournalsAR).toBe(reconciliation.rentInvoiced);
      expect(reconciliation.rentPaymentJournalsBank).toBe(reconciliation.rentReceived);
      expect(reconciliation.expenseJournalsBank).toBe(reconciliation.expensesRecorded);
      expect(reconciliation.cemeteryPaidPerSales).toBe(reconciliation.cemeteryPaymentsTotal);
      expect(exp.every((e) => e.status === 'recorded')).toBe(true);

      const count = async (table: string, eq?: [string, string]) => {
        let q = db.from(table).select('id', { count: 'exact', head: true }).eq('org_id', orgId);
        if (eq) q = q.eq(eq[0], eq[1]);
        const { count: c, error } = await q;
        if (error) throw new Error(`count ${table}: ${error.message}`);
        return c ?? 0;
      };
      const summary = {
        target: IS_PROD ? 'PRODUCTION' : 'local',
        today,
        orgId,
        createdThisRun: created,
        totals: {
          properties: await count('properties'),
          units: await count('units'),
          occupiedUnits: await count('units', ['status', 'occupied']),
          tenants: await count('tenants'),
          leases: await count('leases'),
          rentSchedules: await count('rent_schedules'),
          invoices: await count('invoices'),
          rentPayments: await count('invoice_payments'),
          expenses: await count('expenses'),
          maintenance: await count('maintenance_tickets'),
          graveSites: await count('cemetery_sites'),
          available: await count('cemetery_sites', ['sale_status', 'available']),
          reserved: await count('cemetery_sites', ['sale_status', 'reserved']),
          sold: await count('cemetery_sites', ['sale_status', 'sold']),
          unavailable: await count('cemetery_sites', ['sale_status', 'unavailable']),
          occupied: await count('cemetery_sites', ['burial_status', 'occupied']),
          rightsHolders: await count('cemetery_purchasers'),
          sales: await count('cemetery_sales'),
          cancelledSales: await count('cemetery_sales', ['status', 'cancelled']),
          cemeteryPayments: await count('cemetery_payments'),
          burials: await count('cemetery_burials'),
          siteEvents: await count('cemetery_site_events'),
        },
        reconciliation,
      };
      console.warn(
        `[cemetery demo] ${JSON.stringify(summary)} — login e-mail ${LOGIN_EMAIL}; password only in the credentials file.`,
      );
      expect(summary.totals.graveSites).toBe(120);
      if (process.env.CEMDEMO_EXPECT_NO_CHANGES === '1') {
        // Idempotency proof (CI runs the provisioner twice): the second run must not create or change anything.
        expect(
          Object.values(created).every((n) => n === 0),
          `second run changed data: ${JSON.stringify(created)}`,
        ).toBe(true);
      }
    }, 1_800_000);
  },
);
