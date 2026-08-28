import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  checkApplicantWhatsAppEligibility,
  dispatchApplicationInvitationWhatsApp,
  dispatchApplicationDocumentsRequestedWhatsApp,
  dispatchApplicationApprovedWhatsApp,
  dispatchApplicationDeclinedWhatsApp,
} from '../applicationNotifications';

// WhatsApp launch-completion pass (WORKLOG.md 2026-08-27): the 5 applicant/lease WhatsApp
// templates are now approved -- proves (a) consent enforcement (applicant_whatsapp_consents is the
// real gate, since an applicant has no auth.users/notification_preferences identity), and (b) the
// idempotency fix this same pass made: application_invitation/application_documents_requested now
// accept an optional per-call `dispatchId` (mirroring the email side's already-correct pattern) so
// a genuine "Resend invitation" or a second "request more documents" round is NOT silently
// swallowed by dispatchWhatsApp's own (relatedEntityType, relatedEntityId, templateName)
// already-sent guard -- while application_approved/application_declined correctly keep using
// applicationId alone (an application is decided exactly once, so a retry SHOULD be suppressed).

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let supabaseReachable = false;
try {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
  supabaseReachable = res.ok;
} catch {
  supabaseReachable = false;
}
const describeIfSupabase = supabaseReachable ? describe : describe.skip;

describeIfSupabase('applicationNotifications (real local Supabase integration, MockWhatsAppProvider)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let propertyId: string;
  let unitId: string;
  let applicationId: string;

  beforeEach(async () => {
    const { data: org } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `App Notify Vitest Org ${Date.now()}`, org_type: 'agency' })
      .select('id')
      .single();
    orgId = org!.id;

    const { data: property } = await serviceClient
      .from('properties')
      .insert({ org_id: orgId, nickname: 'App Notify Property', address_line1: '1 Test St', city: 'Cape Town', country: 'ZA', property_type: 'house' })
      .select('id')
      .single();
    propertyId = property!.id;

    const { data: unit } = await serviceClient
      .from('units')
      .insert({ property_id: propertyId, org_id: orgId, unit_label: 'U1', status: 'vacant' })
      .select('id')
      .single();
    unitId = unit!.id;

    const { data: application } = await serviceClient
      .from('applications')
      .insert({
        org_id: orgId,
        property_id: propertyId,
        unit_id: unitId,
        applicant_name: 'WhatsApp Test Applicant',
        applicant_email: 'whatsapp-test-applicant@example.com',
        status: 'submitted',
      })
      .select('id')
      .single();
    applicationId = application!.id;
  });

  afterEach(async () => {
    await serviceClient.from('whatsapp_messages').delete().eq('org_id', orgId);
    await serviceClient.from('applicant_whatsapp_consents').delete().eq('application_id', applicationId);
    await serviceClient.from('applications').delete().eq('id', applicationId);
    await serviceClient.from('units').delete().eq('id', unitId);
    await serviceClient.from('properties').delete().eq('id', propertyId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
  });

  describe('checkApplicantWhatsAppEligibility -- consent is the real gate', () => {
    it('is not eligible when no consent has ever been recorded', async () => {
      const eligibility = await checkApplicantWhatsAppEligibility(serviceClient, applicationId);
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.reason).toBe('no_consent');
    });

    it('is not eligible once the applicant has opted out, even with a phone on file', async () => {
      await serviceClient.from('applicant_whatsapp_consents').insert({
        application_id: applicationId,
        org_id: orgId,
        phone: '+27821234567',
        opted_out_at: new Date().toISOString(),
      });
      const eligibility = await checkApplicantWhatsAppEligibility(serviceClient, applicationId);
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.reason).toBe('opted_out');
    });

    it('is eligible with an affirmative, non-opted-out consent and a phone', async () => {
      await serviceClient.from('applicant_whatsapp_consents').insert({
        application_id: applicationId,
        org_id: orgId,
        phone: '+27821234567',
      });
      const eligibility = await checkApplicantWhatsAppEligibility(serviceClient, applicationId);
      expect(eligibility.eligible).toBe(true);
      expect(eligibility.phone).toBe('+27821234567');
    });
  });

  describe('dispatch -- does not send at all when the applicant is not consent-eligible', () => {
    it('application_invitation is never attempted without consent', async () => {
      const result = await dispatchApplicationInvitationWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'App Notify Property — U1',
        applyUrl: 'https://x/apply/token',
      });
      expect(result.sent).toBe(false);
      expect(result.eligibility.eligible).toBe(false);

      const { count } = await serviceClient
        .from('whatsapp_messages')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId);
      expect(count).toBe(0);
    });
  });

  describe('dispatch -- idempotency fix: invitation resend and a second documents-requested round each get their own send', () => {
    beforeEach(async () => {
      await serviceClient.from('applicant_whatsapp_consents').insert({
        application_id: applicationId,
        org_id: orgId,
        phone: '+27821234567',
      });
    });

    it('application_invitation: same dispatchId is suppressed as already_sent; a fresh dispatchId (a real resend) sends again', async () => {
      // dispatchId feeds dispatchWhatsApp's own relatedEntityId, a real `uuid` column
      // (whatsapp_messages.related_entity_id) -- must be genuine UUIDs, exactly like the real call
      // site passes row.token_id, never an arbitrary label string.
      const tokenId1 = crypto.randomUUID();
      const tokenId2 = crypto.randomUUID();
      const first = await dispatchApplicationInvitationWhatsApp(serviceClient, {
        orgId,
        applicationId,
        dispatchId: tokenId1,
        propertyLabel: 'App Notify Property — U1',
        applyUrl: 'https://x/apply/token-1',
      });
      expect(first.sent).toBe(true);

      const retrySameToken = await dispatchApplicationInvitationWhatsApp(serviceClient, {
        orgId,
        applicationId,
        dispatchId: tokenId1,
        propertyLabel: 'App Notify Property — U1',
        applyUrl: 'https://x/apply/token-1',
      });
      expect(retrySameToken.sent).toBe(false);
      expect(retrySameToken.reason).toBe('already_sent');

      const realResend = await dispatchApplicationInvitationWhatsApp(serviceClient, {
        orgId,
        applicationId,
        dispatchId: tokenId2,
        propertyLabel: 'App Notify Property — U1',
        applyUrl: 'https://x/apply/token-2',
      });
      expect(realResend.sent).toBe(true);
    });

    it('application_invitation: WITHOUT a dispatchId override, a second call falls back to applicationId and is suppressed -- confirms the fallback default, not just the override path', async () => {
      const first = await dispatchApplicationInvitationWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'App Notify Property — U1',
        applyUrl: 'https://x/apply/a',
      });
      expect(first.sent).toBe(true);

      const second = await dispatchApplicationInvitationWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'App Notify Property — U1',
        applyUrl: 'https://x/apply/a',
      });
      expect(second.sent).toBe(false);
      expect(second.reason).toBe('already_sent');
    });

    it('application_documents_requested: a genuine second round (different dispatchId) sends its own message', async () => {
      const round1 = await dispatchApplicationDocumentsRequestedWhatsApp(serviceClient, {
        orgId,
        applicationId,
        dispatchId: crypto.randomUUID(),
        propertyLabel: 'App Notify Property — U1',
      });
      expect(round1.sent).toBe(true);

      const round2 = await dispatchApplicationDocumentsRequestedWhatsApp(serviceClient, {
        orgId,
        applicationId,
        dispatchId: crypto.randomUUID(),
        propertyLabel: 'App Notify Property — U1',
      });
      expect(round2.sent).toBe(true);

      const { count } = await serviceClient
        .from('whatsapp_messages')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('template_name', 'application_documents_requested');
      expect(count).toBe(2);
    });

    it('application_approved: a genuine retry (network/double-click, same applicationId, no dispatchId) is correctly suppressed -- an application is decided exactly once', async () => {
      const first = await dispatchApplicationApprovedWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'App Notify Property — U1',
      });
      expect(first.sent).toBe(true);

      const retry = await dispatchApplicationApprovedWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'App Notify Property — U1',
      });
      expect(retry.sent).toBe(false);
      expect(retry.reason).toBe('already_sent');
    });

    it('application_declined: a genuine retry (same applicationId, no dispatchId) is correctly suppressed', async () => {
      const first = await dispatchApplicationDeclinedWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'App Notify Property — U1',
      });
      expect(first.sent).toBe(true);

      const retry = await dispatchApplicationDeclinedWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'App Notify Property — U1',
      });
      expect(retry.sent).toBe(false);
      expect(retry.reason).toBe('already_sent');
    });
  });
});
