import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Smart Utility scheduled jobs against a real local Supabase: monthly snapshots (idempotent, on the
// billing day only), approval reminders (at most daily), and the whole job's step isolation.

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
delete process.env.RESEND_API_KEY;

const { runMonthlySnapshots, runApprovalReminders, runSmartUtilityJob, jobFailed } = await import('../jobs');
const { sastInstant } = await import('../consumption');

const SUPABASE_URL = 'http://127.0.0.1:54321';
let reachable = false;
try {
  reachable = (await fetch(`${SUPABASE_URL}/auth/v1/health`)).ok;
} catch {
  reachable = false;
}
const describeIfSupabase = reachable ? describe : describe.skip;
const service: SupabaseClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

describeIfSupabase('Smart Utility jobs (real local Supabase integration)', () => {
  const suffix = Date.now();
  let orgId: string;
  let propertyId: string;
  let meterId: string;
  let managerId: string;

  beforeAll(async () => {
    const { data: user } = await service.auth.admin.createUser({ email: `su6-${suffix}@propertyvault.example`, password: 'TestPassw0rd!23', email_confirm: true });
    managerId = user.user!.id;
    const { data: org } = await service.from('organizations').insert({ legal_name: `SU6 ${suffix}`, org_type: 'agency', utilities_enabled: true /* off by default since migration 182 */ }).select('id').single();
    orgId = org!.id;
    await service.from('organization_members').insert({ org_id: orgId, user_id: managerId, role: 'manager', status: 'active', joined_at: new Date().toISOString() });
    const { data: prop } = await service.from('properties').insert({ org_id: orgId, nickname: 'SU6', address_line1: '6', city: 'Durban', province: 'KwaZulu-Natal', postal_code: '4001' }).select('id').single();
    propertyId = prop!.id;
    // Billing day 17 is unused by every other fixture, so only this property is due on the 17th.
    await service.from('municipal_submission_settings').insert({ property_id: propertyId, org_id: orgId, billing_day: 17, mode: 'approval_required' });
    const { data: meter } = await service.from('utility_meters').insert({ org_id: orgId, property_id: propertyId, utility_type: 'water', responsibility_mode: 'owner_paid', meter_role: 'main', ownership: 'municipal' }).select('id').single();
    meterId = meter!.id;
    await service.from('meter_telemetry_readings').insert([
      { org_id: orgId, property_id: propertyId, meter_id: meterId, read_at: sastInstant(2026, 8, 17).toISOString(), raw_value: 1000, multiplier: 1, value: 1000, source: 'device' },
      { org_id: orgId, property_id: propertyId, meter_id: meterId, read_at: sastInstant(2026, 9, 17).toISOString(), raw_value: 4500, multiplier: 1, value: 4500, source: 'device' },
    ]);
  });

  it('writes one snapshot per meter per period, only on the billing day, idempotently', async () => {
    expect((await runMonthlySnapshots(service, sastInstant(2026, 9, 16, 3))).created).toBe(0);
    const first = await runMonthlySnapshots(service, sastInstant(2026, 9, 17, 3));
    expect(first.created).toBeGreaterThanOrEqual(1);
    const again = await runMonthlySnapshots(service, sastInstant(2026, 9, 17, 9));
    expect(again.created).toBe(0);
    const { data } = await service.from('meter_period_snapshots').select('consumption, quality, opening_value, closing_value').eq('meter_id', meterId);
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ quality: 'complete' });
    expect(Number(data![0]!.consumption)).toBe(3500);
  });

  it('reminds about packs awaiting approval at most once a day', async () => {
    const { data: sub } = await service
      .from('municipal_submissions')
      .insert({ org_id: orgId, property_id: propertyId, period_start: '2026-08-17', period_end: '2026-09-17', status: 'pending_approval', mode: 'approval_required', report: {}, created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() })
      .select('id')
      .single();
    const now = new Date();
    await runApprovalReminders(service, now);
    await runApprovalReminders(service, new Date(now.getTime() + 3_600_000));
    const { data: notes } = await service.from('notifications').select('id').eq('user_id', managerId).eq('related_entity_id', sub!.id).eq('type', 'municipal_submission_reminder');
    expect(notes).toHaveLength(1);
    await runApprovalReminders(service, new Date(now.getTime() + 25 * 3_600_000));
    const { data: later } = await service.from('notifications').select('id').eq('user_id', managerId).eq('related_entity_id', sub!.id).eq('type', 'municipal_submission_reminder');
    expect(later).toHaveLength(2);
  });

  it('runs every step of the daily job and reports each independently', async () => {
    const result = await runSmartUtilityJob(service);
    expect(Object.keys(result).sort()).toEqual(
      ['anomalies', 'deliveries', 'health', 'hybridAlerts', 'pollSync', 'reconciliation', 'reminders', 'retention', 'snapshots', 'statusSync', 'submissions'].sort(),
    );
    expect(jobFailed(result)).toBe(false);
  }, 120_000);
});
