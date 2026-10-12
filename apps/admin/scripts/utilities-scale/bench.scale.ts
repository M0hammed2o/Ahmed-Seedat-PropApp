import { describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Smart Utilities SCALE benchmark — DISPOSABLE databases only, after scripts/utilities-scale/seed.sql.
//   npx vitest run -c vitest.demo.config.ts scripts/utilities-scale      (from apps/admin)
// Prerequisite for realistic job timings: scale meters connected (seed.sql sets connectivity 'http_push').
// Prints timings; the only assertions are sanity checks plus a refusal on databases with 200+ organisations
// (seed.sql adds 3, so a fresh disposable stack stays far below that).

const URL_ = 'http://127.0.0.1:54321';
const SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
for (const k of ['RESEND_API_KEY', 'RESEND_FROM_ADDRESS', 'SMART_UTILITY_TENANT_STATEMENTS_ENABLED', 'SMART_UTILITY_AUTO_SUBMISSION_ENABLED', 'SMART_UTILITY_TELEMETRY_RETENTION_DAYS']) {
  delete process.env[k];
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const ms = (t0: number) => Math.round(performance.now() - t0);

describe('Smart Utilities scale benchmark (disposable database)', () => {
  it('times billing, dashboards, the daily job and ingestion on the scale dataset', async () => {
    const service: SupabaseClient = createClient(URL_, SERVICE_KEY, opts);
    const { count } = await service.from('organizations').select('id', { count: 'exact', head: true });
    expect(count ?? 0).toBeLessThan(200);
    const { data: orgs } = await service.from('organizations').select('id').like('legal_name', 'SCALE Org %').order('legal_name');
    expect(orgs?.length, 'run scripts/utilities-scale/seed.sql first').toBe(3);
    const orgId = orgs![0]!.id as string;

    const billing = await import('@/lib/smartUtility/billing');
    const { loadUtilityPortfolio } = await import('@/lib/smartUtility/portfolio');
    const { loadHybridDashboard } = await import('@/lib/smartUtility/hybridDashboard');
    const { runSmartUtilityJob } = await import('@/lib/smartUtility/jobs');
    const report: Record<string, unknown> = {};

    // A manager of org 1 (100 properties) for the RLS-bound portfolio and dashboard reads.
    const email = `scale-${Date.now()}@propertyvault.example`;
    const userId = (await service.auth.admin.createUser({ email, password: 'TestPassw0rd!23', email_confirm: true })).data.user!.id;
    await service.from('organization_members').insert({ org_id: orgId, user_id: userId, role: 'principal', status: 'active', joined_at: new Date().toISOString(), property_access_mode: 'all' });
    const staff = createClient(URL_, ANON_KEY, opts);
    await staff.auth.signInWithPassword({ email, password: 'TestPassw0rd!23' });

    // Last full calendar month (SAST) inside the 180 days of readings.
    const now = new Date();
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const period = { periodStart: first.toISOString().slice(0, 10), periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10) };
    const { data: props } = await service.from('properties').select('id').eq('org_id', orgId).order('nickname').limit(10);

    // 1. Scheduled billing: 10 properties × 10 units, sequential.
    let t0 = performance.now();
    let created = 0;
    let existing = 0; // a re-run on the same dataset finds every charge already there (never billed twice)
    for (const p of props!) {
      const r = await billing.generateCharges(service, { propertyId: p.id, ...period, actorUserId: userId });
      created += r.created;
      existing += r.existing;
    }
    const tenMs = ms(t0);
    report.billing = { properties: props!.length, chargesCreated: created, chargesAlreadyThere: existing, totalMs: tenMs, perPropertyMs: Math.round(tenMs / props!.length), projected300PropertiesS: Math.round((tenMs / props!.length) * 300 / 1000) };
    expect(created + existing).toBe(100);

    // 2. Portfolio (100 properties) and one property's dashboard over 30 days, as the manager (RLS).
    t0 = performance.now();
    const portfolio = await loadUtilityPortfolio(staff, { months: 6 });
    report.portfolioMs = ms(t0);
    report.portfolioPropertyCount = Array.isArray((portfolio as { properties?: unknown[] }).properties) ? (portfolio as { properties: unknown[] }).properties.length : 'n/a';
    t0 = performance.now();
    await loadHybridDashboard(staff, props![0]!.id, { from: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) });
    report.dashboard30dMs = ms(t0);

    // 3. The whole daily Smart Utilities job over 6 600 meters and 1.25 M readings.
    t0 = performance.now();
    const job = await runSmartUtilityJob(service, now);
    report.dailyJobMs = ms(t0);
    report.dailyJobSteps = job; // per-step results (what each step actually processed)
    // Billing day (the 1st, 03:00 SAST): reconciliation and monthly snapshots do their month-end work too.
    const billingDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 1));
    t0 = performance.now();
    const monthEnd = await runSmartUtilityJob(service, billingDay);
    report.billingDayJobMs = ms(t0);
    report.billingDayJobSteps = { anomalies: monthEnd.anomalies, reconciliation: monthEnd.reconciliation, snapshots: monthEnd.snapshots, health: monthEnd.health };

    // 4. Ingestion: one 500-reading batch for one meter (the batch RPC path the ingest route uses).
    const { data: m } = await service.from('utility_meters').select('id, org_id, property_id').eq('org_id', orgId).eq('meter_role', 'main').limit(1).single();
    const rows = Array.from({ length: 500 }, (_, i) => ({
      org_id: m!.org_id, property_id: m!.property_id, meter_id: m!.id, read_at: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
      raw_value: 900_000 - i, multiplier: 1, value: 900_000 - i, source: 'simulator', status: 'valid',
    }));
    t0 = performance.now();
    const { data: inserted, error } = await service.rpc('ingest_telemetry_batch', { p_rows: rows });
    report.ingest500Ms = ms(t0);
    expect(error).toBeNull();
    expect(inserted).toHaveLength(500);

    console.warn(`[scale benchmark] ${JSON.stringify(report, null, 2)}`);
  }, 1_800_000);
});
