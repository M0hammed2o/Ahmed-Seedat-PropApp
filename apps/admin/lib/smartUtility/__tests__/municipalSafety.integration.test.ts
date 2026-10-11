import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Municipal sending safety (docs/UTILITIES_SECURITY_FINDINGS.md MUN-A…D), real local Supabase, injected sender:
// nothing is emailed. Retries send the APPROVED snapshot; recipients added after approval are not sent the pack;
// a withdrawn recipient or a switched-off automatic flag stops sending; overlapping job runs send once.

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
delete process.env.RESEND_API_KEY;
delete process.env.SMART_UTILITY_AUTO_SUBMISSION_ENABLED;

const { approveSubmission, sendDueDeliveries, freezePack } = await import('../submissions');

const URL_ = 'http://127.0.0.1:54321';
let reachable = false;
try {
  reachable = (await fetch(`${URL_}/auth/v1/health`)).ok;
} catch {
  reachable = false;
}
const d = reachable ? describe : describe.skip;
const service: SupabaseClient = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

const report = (start: string) => ({
  version: 1, generatedAt: new Date().toISOString(), property: { name: 'MS', address: '1 Safe St' }, preparedFor: 'Owner', municipality: null,
  municipalAccountNumber: '5000000000', period: { start, end: start }, meters: [], notes: [],
});

d('municipal sending safety (real local Supabase)', () => {
  const sfx = Date.now();
  let orgId: string;
  let propertyId: string;
  let userId: string;
  const now = new Date();
  /** Deliveries are stamped due with the real clock; send a moment later. */
  const soon = () => new Date(Date.now() + 5_000);
  const ok = vi.fn(async () => ({ sent: true, deliveryConfigured: false, emailMessageId: undefined }));

  const recipient = (email: string) =>
    service.from('municipal_submission_recipients').insert({ org_id: orgId, property_id: propertyId, email, recipient_type: 'custom', authorised_at: now.toISOString() }).select('id').single();
  const pack = async (start: string, extra: Record<string, unknown> = {}) =>
    (await service.from('municipal_submissions').insert({ org_id: orgId, property_id: propertyId, period_start: start, period_end: `${start.slice(0, 8)}28`, status: 'pending_approval', mode: 'approval_required', report: report(start), rendered_email: { subject: `Readings ${start}`, bodyText: 'Approved body', to: [`a-${sfx}@example.com`], cc: [] }, ...extra }).select('id').single()).data!.id as string;

  beforeAll(async () => {
    userId = (await service.auth.admin.createUser({ email: `ms-${sfx}@propertyvault.example`, password: 'TestPassw0rd!23', email_confirm: true })).data.user!.id;
    orgId = (await service.from('organizations').insert({ legal_name: `MS ${sfx}`, org_type: 'agency' }).select('id').single()).data!.id;
    propertyId = (await service.from('properties').insert({ org_id: orgId, nickname: 'MS', address_line1: '1 Safe St', city: 'Durban', province: 'KwaZulu-Natal', postal_code: '4001' }).select('id').single()).data!.id;
    await recipient(`a-${sfx}@example.com`);
  }, 60_000);

  it('freezes the approved message; a recipient added afterwards is not sent the pack; retries send identical content', async () => {
    const id = await pack('2025-01-01');
    await approveSubmission(service, { submissionId: id, actorUserId: userId, now });
    await recipient(`late-${sfx}@example.com`); // authorised AFTER approval
    const { data: dels } = await service.from('municipal_submission_deliveries').select('recipient_email').eq('submission_id', id);
    expect(dels!.map((x) => x.recipient_email)).toEqual([`a-${sfx}@example.com`]);
    const { data: sub } = await service.from('municipal_submissions').select('rendered_email').eq('id', id).single();
    expect((sub!.rendered_email as { frozen?: { to: string[] } }).frozen?.to).toEqual([`a-${sfx}@example.com`]);

    const calls: unknown[] = [];
    const flaky = vi.fn(async (_c: unknown, input: { templateVars: unknown; files: unknown; cc: unknown }) => {
      calls.push(JSON.stringify({ v: input.templateVars, f: input.files, cc: input.cc }));
      if (calls.length === 1) throw new Error('SMTP 451 temporary');
      return { sent: true, deliveryConfigured: false };
    });
    // Settings change between attempts must not change what is sent.
    await service.from('municipal_submission_settings').upsert({ property_id: propertyId, org_id: orgId, include_photos: false, cc_emails: [`cc-${sfx}@example.com`] }, { onConflict: 'property_id' });
    await sendDueDeliveries(service, { submissionId: id, now: soon(), sender: flaky as never });
    await sendDueDeliveries(service, { submissionId: id, now: new Date(Date.now() + 2 * 3_600_000), sender: flaky as never });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(calls[0]);
  }, 60_000);

  it('two overlapping job runs send a delivery once', async () => {
    const id = await pack('2025-02-01');
    await approveSubmission(service, { submissionId: id, actorUserId: userId, now });
    ok.mockClear();
    await Promise.all([sendDueDeliveries(service, { submissionId: id, now: soon(), sender: ok as never }), sendDueDeliveries(service, { submissionId: id, now: soon(), sender: ok as never })]);
    expect(ok).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('a withdrawn recipient is not sent to, and is not retried', async () => {
    const id = await pack('2025-03-01');
    await approveSubmission(service, { submissionId: id, actorUserId: userId, now });
    await service.from('municipal_submission_recipients').update({ active: false }).eq('property_id', propertyId).eq('email', `a-${sfx}@example.com`);
    try {
      ok.mockClear();
      const r = await sendDueDeliveries(service, { submissionId: id, now: soon(), sender: ok as never });
      expect(ok).not.toHaveBeenCalled();
      expect(r.exhausted).toBe(1);
      const { data: del } = await service.from('municipal_submission_deliveries').select('status, next_attempt_at, last_error').eq('submission_id', id).single();
      expect(del).toMatchObject({ status: 'failed', next_attempt_at: null });
      expect(del!.last_error).toMatch(/no longer authorised/);
    } finally {
      await service.from('municipal_submission_recipients').update({ active: true }).eq('property_id', propertyId).eq('email', `a-${sfx}@example.com`);
    }
  }, 60_000);

  it('an automatically scheduled pack is held when automatic sending is switched off', async () => {
    const id = await pack('2025-04-01', { mode: 'automatic', status: 'scheduled', scheduled_for: now.toISOString() });
    await freezePack(service, id, now);
    await service.from('municipal_submission_deliveries').insert({ org_id: orgId, property_id: propertyId, submission_id: id, recipient_email: `a-${sfx}@example.com`, recipient_type: 'custom', next_attempt_at: now.toISOString() });
    ok.mockClear();
    await sendDueDeliveries(service, { submissionId: id, now: soon(), sender: ok as never });
    expect(ok).not.toHaveBeenCalled();
    const { data: del } = await service.from('municipal_submission_deliveries').select('last_error').eq('submission_id', id).single();
    expect(del!.last_error).toMatch(/automatic sending is off/);
  }, 60_000);

  it('an approved photo that disappeared blocks the send instead of sending a different pack', async () => {
    const id = await pack('2025-05-01');
    await service
      .from('municipal_submissions')
      .update({ rendered_email: { subject: 'x', bodyText: 'y', to: [`a-${sfx}@example.com`], cc: [], frozen: { includePhotos: true, photos: [{ id: '0f1e2d3c-0000-4000-8000-000000000099', sha256: 'a'.repeat(64), filename: 'p.jpg', contentType: 'image/jpeg' }], to: [`a-${sfx}@example.com`], cc: [], frozenAt: now.toISOString() } } })
      .eq('id', id);
    await approveSubmission(service, { submissionId: id, actorUserId: userId, now });
    ok.mockClear();
    await sendDueDeliveries(service, { submissionId: id, now: soon(), sender: ok as never });
    expect(ok).not.toHaveBeenCalled();
    const { data: del } = await service.from('municipal_submission_deliveries').select('status, last_error').eq('submission_id', id).single();
    expect(del!.last_error).toMatch(/no longer available/);
  }, 60_000);
});
