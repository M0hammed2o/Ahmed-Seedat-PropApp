import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Per-organisation Smart Utilities switch (organizations.utilities_enabled, migration 179): when off, device ingestion
// is refused, utility alerts and municipal sends are skipped, and the API gate reports the module as disabled. Other
// Proplyst features are untouched. Real local Supabase.

vi.mock('server-only', () => ({}));
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
delete process.env.RESEND_API_KEY;

const { authenticateIntegration, disabledUtilityOrgs } = await import('../ingest');
const { issueToken } = await import('../tokens');
const { loadReadableProperty } = await import('../http');
const { sendDueDeliveries } = await import('../submissions');

const URL_ = 'http://127.0.0.1:54321';
let reachable = false;
try {
  reachable = (await fetch(`${URL_}/auth/v1/health`)).ok;
} catch {
  reachable = false;
}
const d = reachable ? describe : describe.skip;
const service: SupabaseClient = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

d('Smart Utilities per-organisation switch (real local Supabase)', () => {
  const sfx = Date.now();
  let orgId: string;
  let propertyId: string;
  let token: string;

  beforeAll(async () => {
    orgId = (await service.from('organizations').insert({ legal_name: `SW ${sfx}`, org_type: 'agency' }).select('id').single()).data!.id;
    propertyId = (await service.from('properties').insert({ org_id: orgId, nickname: 'SW', address_line1: '1', city: 'Durban', province: 'KwaZulu-Natal', postal_code: '4001' }).select('id').single()).data!.id;
    const t = issueToken();
    token = t.token;
    await service.from('meter_integrations').insert({ org_id: orgId, property_id: propertyId, provider: 'generic_json', name: 'SW gw', token_prefix: t.prefix, token_hash: t.hash });
  });

  it('enabled by default: ingestion authenticates and the API gate is open', async () => {
    expect((await authenticateIntegration(service, token)).ok).toBe(true);
    expect((await loadReadableProperty(service, propertyId))?.utilities_enabled).toBe(true);
    expect((await disabledUtilityOrgs(service)).has(orgId)).toBe(false);
  });

  it('disabled: ingestion refused, API gate closed, municipal deliveries paused', async () => {
    await service.from('organizations').update({ utilities_enabled: false }).eq('id', orgId);
    try {
      expect(await authenticateIntegration(service, token)).toEqual({ ok: false, reason: 'utilities_disabled' });
      expect((await loadReadableProperty(service, propertyId))?.utilities_enabled).toBe(false);
      expect((await disabledUtilityOrgs(service)).has(orgId)).toBe(true);
      const { data: sub } = await service
        .from('municipal_submissions')
        .insert({ org_id: orgId, property_id: propertyId, period_start: '2025-06-01', period_end: '2025-06-28', status: 'scheduled', mode: 'approval_required', report: { meters: [] } })
        .select('id')
        .single();
      await service.from('municipal_submission_recipients').insert({ org_id: orgId, property_id: propertyId, email: `sw-${sfx}@example.com`, recipient_type: 'custom', authorised_at: new Date().toISOString() });
      await service.from('municipal_submission_deliveries').insert({ org_id: orgId, property_id: propertyId, submission_id: sub!.id, recipient_email: `sw-${sfx}@example.com`, recipient_type: 'custom', next_attempt_at: new Date(Date.now() - 60_000).toISOString() });
      const sender = vi.fn();
      const r = await sendDueDeliveries(service, { submissionId: sub!.id, now: new Date(), sender: sender as never });
      expect(sender).not.toHaveBeenCalled();
      expect(r.attempted).toBe(0);
      const { data: del } = await service.from('municipal_submission_deliveries').select('status, attempts').eq('submission_id', sub!.id).single();
      expect(del).toEqual({ status: 'pending', attempts: 0 }); // paused, not failed: resumes when re-enabled
    } finally {
      await service.from('organizations').update({ utilities_enabled: true }).eq('id', orgId);
    }
  });
});
