import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Municipal reporting (migration 176) against a real local Supabase: preview, draft preview,
// placeholder validation, hash-bound approval, schedule gating, approval withdrawal on any change,
// test send only to the user's own address, and scheduled generation + delivery with CC.
// Email always goes through the mock provider (RESEND_* unset).

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

let mockAuthorizationHeader: string | null = null;
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (n: string) => (n.toLowerCase() === 'authorization' ? mockAuthorizationHeader : null) }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, getAll: () => [] }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM_ADDRESS;
const originalFlag = process.env.SMART_UTILITY_AUTO_SUBMISSION_ENABLED;

const { PUT: putSettings } = await import('../settings/route');
const { POST: addRecipient } = await import('../recipients/route');
const { POST: preview, GET: previewPdf } = await import('../preview/route');
const { POST: testSend } = await import('../test-send/route');
const { POST: approveTemplate } = await import('../approve-template/route');
const { POST: submissionAction } = await import('../../../../municipal-submissions/[id]/route');
const { generateSubmission, sendDueDeliveries } = await import('@/lib/smartUtility/submissions');
const { lastCompleteBillingPeriod } = await import('@/lib/smartUtility/consumption');

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
let reachable = false;
try {
  reachable = (await fetch(`${SUPABASE_URL}/auth/v1/health`)).ok;
} catch {
  reachable = false;
}
const describeIfSupabase = reachable ? describe : describe.skip;
const service: SupabaseClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

async function makeUser(email: string) {
  const { data, error } = await service.auth.admin.createUser({ email, password: 'TestPassw0rd!23', email_confirm: true });
  if (error) throw error;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassw0rd!23' }),
  });
  return { id: data.user!.id, token: (await res.json()).access_token as string, email };
}
const as = (t: string) => (mockAuthorizationHeader = `Bearer ${t}`);
const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/x', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const p = (id: string) => ({ params: Promise.resolve({ id }) });

const baseSettings = {
  municipalityCode: 'tshwane',
  municipalAccountNumber: '5001234567',
  mode: 'approval_required',
  billingDay: 25,
  leadDays: 5,
  includePhotos: false,
  enabled: true,
  ccEmails: ['accountant@example.com'],
  accountHolderName: 'J Smith',
  customMessage: 'Gate code 1234',
  subjectTemplate: 'Readings {{account_number}} — {{period_end}}',
  bodyTemplate: 'Good day,\n\n{{readings}}\n\n{{custom_message}}\n\n{{sender}}',
};

describeIfSupabase('Municipal reporting (real local Supabase integration)', () => {
  const suffix = Date.now();
  let propertyId: string;
  let orgId: string;
  let manager: Awaited<ReturnType<typeof makeUser>>;
  let viewer: Awaited<ReturnType<typeof makeUser>>;
  let previewHash: string;

  beforeAll(async () => {
    manager = await makeUser(`su3-manager-${suffix}@propertyvault.example`);
    viewer = await makeUser(`su3-viewer-${suffix}@propertyvault.example`);
    const { data: org } = await service.from('organizations').insert({ legal_name: `SU3 ${suffix}`, org_type: 'agency', utilities_enabled: true /* off by default since migration 182 */ }).select('id').single();
    orgId = org!.id;
    await service.from('organization_members').insert([
      { org_id: orgId, user_id: manager.id, role: 'manager', status: 'active', joined_at: new Date().toISOString() },
      { org_id: orgId, user_id: viewer.id, role: 'viewer', status: 'active', joined_at: new Date().toISOString() },
    ]);
    const { data: prop } = await service
      .from('properties')
      .insert({ org_id: orgId, nickname: 'SU3 House', address_line1: '9 Reading Rd', city: 'Pretoria', province: 'Gauteng', postal_code: '0002' })
      .select('id')
      .single();
    propertyId = prop!.id;
    const { data: meter } = await service
      .from('utility_meters')
      .insert({ org_id: orgId, property_id: propertyId, utility_type: 'water', responsibility_mode: 'owner_paid', meter_role: 'main', ownership: 'municipal', meter_number: 'TSH-77' })
      .select('id')
      .single();
    const period = lastCompleteBillingPeriod(new Date(), 25);
    await service.from('meter_telemetry_readings').insert([
      { org_id: orgId, property_id: propertyId, meter_id: meter!.id, read_at: new Date(period.start.getTime() - 86_400_000).toISOString(), raw_value: 1_000_000, multiplier: 1, value: 1_000_000, source: 'manual', verification_status: 'verified' },
      { org_id: orgId, property_id: propertyId, meter_id: meter!.id, read_at: new Date(period.end.getTime() - 3 * 86_400_000).toISOString(), raw_value: 1_006_000, multiplier: 1, value: 1_006_000, source: 'manual', verification_status: 'verified' },
      // Today's reading: the preview covers the period the NEXT send will cover (current period).
      { org_id: orgId, property_id: propertyId, meter_id: meter!.id, read_at: new Date(Date.now() - 3_600_000).toISOString(), raw_value: 1_018_500, multiplier: 1, value: 1_018_500, source: 'manual', verification_status: 'verified' },
    ]);
    as(manager.token);
  });

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.SMART_UTILITY_AUTO_SUBMISSION_ENABLED;
    else process.env.SMART_UTILITY_AUTO_SUBMISSION_ENABLED = originalFlag;
  });

  it('rejects unknown placeholders', async () => {
    const res = await putSettings(req('PUT', { ...baseSettings, bodyTemplate: 'Hi {{bank_details}}' }), p(propertyId));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('unknown_placeholders');
  });

  it('saves settings and previews exactly what would be sent', async () => {
    expect((await putSettings(req('PUT', baseSettings), p(propertyId))).status).toBe(200);
    expect((await addRecipient(req('POST', { email: `agent-${suffix}@example.com`, recipientType: 'managing_agent', authorise: true }), p(propertyId))).status).toBe(201);
    const res = await preview(req('POST'), p(propertyId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.to).toEqual([`agent-${suffix}@example.com`]);
    expect(body.cc).toEqual(['accountant@example.com']);
    expect(body.subject).toMatch(/^Readings 5001234567 — \d{4}-\d{2}-\d{2}$/);
    // previous = last reading at/before the current period start (1 006 kL), current = today's (1 018,5 kL)
    expect(body.bodyText).toMatch(/Consumption: 12[.,]5 kL/);
    expect(body.warnings.missingReadings).toBe(0);
    expect(body.bodyText).toContain('Gate code 1234');
    expect(body.attachments.map((a: { contentType: string }) => a.contentType)).toEqual(['application/pdf', 'text/csv']);
    expect(body.approved).toBe(false);
    expect(body.isDraft).toBe(false);
    previewHash = body.templateHash;
    const draft = await (await preview(req('POST', { subjectTemplate: 'Draft {{property_name}}' }), p(propertyId))).json();
    expect(draft.subject).toBe('Draft SU3 House');
    expect(draft.isDraft).toBe(true);
    expect(draft.templateHash).not.toBe(previewHash);
    const pdf = await previewPdf(new NextRequest('http://localhost/x?format=pdf'), p(propertyId));
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('refuses to schedule before approval, and refuses approval of an outdated or draft preview', async () => {
    const sched = await putSettings(req('PUT', { ...baseSettings, scheduleEnabled: true }), p(propertyId));
    expect(sched.status).toBe(409);
    expect((await sched.json()).error.code).toBe('template_not_approved');
    expect((await approveTemplate(req('POST', { templateHash: 'a'.repeat(64) }), p(propertyId))).status).toBe(409);
    as(viewer.token);
    expect((await approveTemplate(req('POST', { templateHash: previewHash }), p(propertyId))).status).toBe(403);
    as(manager.token);
  });

  it('approves the previewed content and then allows scheduling', async () => {
    const res = await approveTemplate(req('POST', { templateHash: previewHash }), p(propertyId));
    expect(res.status).toBe(200);
    expect((await putSettings(req('PUT', { ...baseSettings, mode: 'automatic', scheduleEnabled: true }), p(propertyId))).status).toBe(200);
    const { data } = await service.from('municipal_submission_settings').select('schedule_enabled, template_hash').eq('property_id', propertyId).single();
    expect(data).toMatchObject({ schedule_enabled: true, template_hash: previewHash });
    const { data: audit } = await service.from('audit_events').select('after').eq('action', 'municipal_template.approved').eq('org_id', orgId);
    expect((audit![0]!.after as { subject: string }).subject).toMatch(/^Readings 5001234567/);
  });

  it('withdraws approval and stops scheduling when the content changes (custom message or a new recipient)', async () => {
    const changed = await putSettings(req('PUT', { ...baseSettings, mode: 'automatic', customMessage: 'Gate code 9999' }), p(propertyId));
    expect((await changed.json()).approvalWithdrawn).toBe(true);
    const { data } = await service.from('municipal_submission_settings').select('schedule_enabled, template_hash').eq('property_id', propertyId).single();
    expect(data).toMatchObject({ schedule_enabled: false, template_hash: null });

    // Re-approve, then add a recipient: approval withdrawn again.
    const hash = (await (await preview(req('POST'), p(propertyId))).json()).templateHash;
    expect((await approveTemplate(req('POST', { templateHash: hash }), p(propertyId))).status).toBe(200);
    const add = await addRecipient(req('POST', { email: `second-${suffix}@example.com`, recipientType: 'accountant', authorise: true }), p(propertyId));
    expect((await add.json()).approvalWithdrawn).toBe(true);
  });

  it('test send goes only to the signed-in user (mock provider) and creates no deliveries', async () => {
    const res = await testSend(req('POST'), p(propertyId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ sentTo: manager.email, deliveryConfigured: false });
    const { data: msgs } = await service.from('email_messages').select('to_address, subject, related_entity_type').eq('org_id', orgId).eq('related_entity_type', 'municipal_template_test');
    expect(msgs!.map((m) => m.to_address)).toEqual([manager.email]);
    expect(msgs![0]!.subject).toMatch(/^\[TEST\] /);
    const { count } = await service.from('municipal_submission_deliveries').select('id', { count: 'exact', head: true }).eq('property_id', propertyId);
    expect(count).toBe(0);
  });

  it('without the platform flag, an approved automatic schedule still waits for approval', async () => {
    delete process.env.SMART_UTILITY_AUTO_SUBMISSION_ENABLED;
    const hash = (await (await preview(req('POST'), p(propertyId))).json()).templateHash;
    await approveTemplate(req('POST', { templateHash: hash }), p(propertyId));
    await putSettings(req('PUT', { ...baseSettings, mode: 'automatic', customMessage: 'Gate code 9999', scheduleEnabled: true }), p(propertyId));
    const period = lastCompleteBillingPeriod(new Date(), 25);
    const older = { start: new Date(period.start.getTime() - 31 * 86_400_000), end: period.start };
    const res = await generateSubmission(service, { propertyId, period: older, actorUserId: null });
    expect(res.status).toBe('pending_approval');
  });

  it('with the flag on and a current approval, generation schedules the pack and delivery sends the approved snapshot with CC', async () => {
    process.env.SMART_UTILITY_AUTO_SUBMISSION_ENABLED = 'true';
    const res = await generateSubmission(service, { propertyId, actorUserId: null });
    expect(res.status).toBe('scheduled');
    const { data: sub } = await service.from('municipal_submissions').select('rendered_email, template_hash, scheduled_for').eq('id', res.submissionId).single();
    const rendered = sub!.rendered_email as { subject: string; to: string[]; cc: string[] };
    expect(rendered.to.sort()).toEqual([`agent-${suffix}@example.com`, `second-${suffix}@example.com`].sort());
    expect(rendered.cc).toEqual(['accountant@example.com']);
    expect(sub!.scheduled_for).not.toBeNull();

    const sent = await sendDueDeliveries(service, { submissionId: res.submissionId });
    expect(sent.sent).toBe(2);
    const { data: deliveries } = await service.from('municipal_submission_deliveries').select('cc_emails, status').eq('submission_id', res.submissionId);
    expect(deliveries!.filter((d) => (d.cc_emails as string[]).length > 0)).toHaveLength(1); // CC once, not per recipient
    const { data: msgs } = await service.from('email_messages').select('subject').eq('related_entity_type', 'municipal_submission_delivery').eq('org_id', orgId);
    expect(msgs!.every((m) => m.subject === rendered.subject)).toBe(true);
    const { data: done } = await service.from('municipal_submissions').select('status, acceptance_status').eq('id', res.submissionId).single();
    expect(done).toMatchObject({ status: 'sent', acceptance_status: 'unknown' });
  });

  it('a scheduled pack that has not been sent can still be cancelled', async () => {
    const { data: sub } = await service
      .from('municipal_submissions')
      .insert({ org_id: orgId, property_id: propertyId, period_start: '2025-01-25', period_end: '2025-02-25', status: 'scheduled', mode: 'automatic', report: {}, scheduled_for: new Date(Date.now() + 86_400_000).toISOString() })
      .select('id')
      .single();
    const res = await submissionAction(req('POST', { action: 'cancel' }), p(sub!.id));
    expect(res.status).toBe(200);
    const { data } = await service.from('municipal_submissions').select('status').eq('id', sub!.id).single();
    expect(data!.status).toBe('cancelled');
  });
});
