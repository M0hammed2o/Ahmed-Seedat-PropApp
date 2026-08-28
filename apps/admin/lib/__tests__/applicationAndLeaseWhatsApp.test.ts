import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  checkApplicantWhatsAppEligibility,
  dispatchApplicationInvitationWhatsApp,
  dispatchApplicationDocumentsRequestedWhatsApp,
  dispatchApplicationApprovedWhatsApp,
  dispatchApplicationDeclinedWhatsApp,
} from '../applicationNotifications';

// First-tenant-workflow predeploy pass (WORKLOG.md 2026-08-25), Phase 8: mock-only coverage for
// the 5 new applicant/lease WhatsApp events (application_invitation, application_documents_
// requested, application_approved, application_declined, lease_ready). Same real-local-Supabase
// pattern as whatsappDispatch.test.ts -- no real WhatsApp send anywhere in this file:
// MockWhatsAppProvider is what runs whenever WHATSAPP_ACCESS_TOKEN/PHONE_NUMBER_ID/WEBHOOK_SECRET
// aren't set (the default in this test environment).
//
// WhatsApp launch-completion pass, variable-structure reconciliation (WORKLOG.md 2026-08-27): all
// 5 of these templates are now approved (Mohammed's real Meta template documents, confirmed and
// reconciled) -- this file originally had a "template-approval gate" describe block per event
// (plus one for lease_ready) proving dispatchWhatsApp() returned 'template_not_approved' BEFORE
// ever calling getWhatsAppProvider(), by stubbing fake-but-present Meta credentials. That premise
// is now false for these 5 specific templates (they're genuinely approved), so those blocks are
// removed here rather than left asserting a stale, now-incorrect expectation. The safety property
// they proved (an unapproved template is blocked before any provider call) is still real,
// still-tested production logic -- it now has dedicated unit coverage instead, via a scoped
// registry spy, in whatsappDispatch.failureHandling.test.ts (not tied to these 5 template names,
// which can never be used to exercise that path again now that they're all approved). The
// successful-send case these old blocks would have degenerated into testing is already covered by
// the "eligible... MockWhatsAppProvider" describe block directly above, and the equivalent
// "does not send twice" test right above the removed lease_ready block -- so no coverage was lost,
// only a now-inapplicable scenario removed.
//
// dispatchLeaseReadyWhatsApp() (unlike the applicationNotifications.ts functions above, which
// take a serviceClient parameter) calls getServiceRoleClient() internally, which validates these
// three env vars via zod -- must be set before that module is ever imported/called, same
// requirement as every other route-level integration test in this codebase (e.g. the OCR extract
// route test).
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

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

describeIfSupabase('applicant/lease WhatsApp events (real local Supabase integration, mock provider)', () => {
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
      .insert({ legal_name: `App WhatsApp Vitest Org ${Date.now()}`, org_type: 'agency' })
      .select('id')
      .single();
    orgId = org!.id;

    const { data: property } = await serviceClient
      .from('properties')
      .insert({ org_id: orgId, nickname: 'WhatsApp Test Property', address_line1: '1 Test St', city: 'Cape Town', country: 'ZA', property_type: 'house' })
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
      .insert({ org_id: orgId, property_id: propertyId, unit_id: unitId, applicant_name: 'WhatsApp Test Applicant', status: 'invited' })
      .select('id')
      .single();
    applicationId = application!.id;
  });

  afterEach(async () => {
    await serviceClient.from('applicant_whatsapp_consents').delete().eq('application_id', applicationId);
    await serviceClient.from('whatsapp_messages').delete().eq('org_id', orgId);
    await serviceClient.from('applications').delete().eq('id', applicationId);
    await serviceClient.from('units').delete().eq('id', unitId);
    await serviceClient.from('properties').delete().eq('id', propertyId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
  });

  describe('checkApplicantWhatsAppEligibility', () => {
    it('is ineligible (no_consent) when the applicant has never recorded a consent row', async () => {
      const result = await checkApplicantWhatsAppEligibility(serviceClient, applicationId);
      expect(result).toEqual({ eligible: false, reason: 'no_consent' });
    });

    it('is ineligible (opted_out) once the applicant has explicitly opted out', async () => {
      await serviceClient.from('applicant_whatsapp_consents').insert({
        application_id: applicationId,
        org_id: orgId,
        phone: '+27821234567',
        opted_in_at: new Date().toISOString(),
        opted_out_at: new Date().toISOString(),
      });
      const result = await checkApplicantWhatsAppEligibility(serviceClient, applicationId);
      expect(result).toEqual({ eligible: false, reason: 'opted_out' });
    });

    it('is eligible once real, unrevoked consent with a phone number is on file', async () => {
      await serviceClient.from('applicant_whatsapp_consents').insert({
        application_id: applicationId,
        org_id: orgId,
        phone: '+27821234567',
        opted_in_at: new Date().toISOString(),
      });
      const result = await checkApplicantWhatsAppEligibility(serviceClient, applicationId);
      expect(result).toEqual({ eligible: true, phone: '+27821234567' });
    });
  });

  describe('dispatch functions -- no consent recorded (blocked before any send attempt)', () => {
    it('dispatchApplicationInvitationWhatsApp is blocked, sends nothing', async () => {
      const result = await dispatchApplicationInvitationWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'WhatsApp Test Property — U1',
      });
      expect(result.sent).toBe(false);
      expect(result.eligibility).toEqual({ eligible: false, reason: 'no_consent' });

      const { data: messages } = await serviceClient.from('whatsapp_messages').select('id').eq('org_id', orgId);
      expect(messages).toEqual([]);
    });

    it('dispatchApplicationDocumentsRequestedWhatsApp is blocked, sends nothing', async () => {
      const result = await dispatchApplicationDocumentsRequestedWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'WhatsApp Test Property — U1',
      });
      expect(result.sent).toBe(false);
      expect(result.eligibility.eligible).toBe(false);
    });

    it('dispatchApplicationApprovedWhatsApp is blocked, sends nothing', async () => {
      const result = await dispatchApplicationApprovedWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'WhatsApp Test Property — U1',
      });
      expect(result.sent).toBe(false);
      expect(result.eligibility.eligible).toBe(false);
    });

    it('dispatchApplicationDeclinedWhatsApp is blocked, sends nothing', async () => {
      const result = await dispatchApplicationDeclinedWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'WhatsApp Test Property — U1',
      });
      expect(result.sent).toBe(false);
      expect(result.eligibility.eligible).toBe(false);
    });
  });

  describe('dispatch functions -- opted out (blocked even though a consent row exists)', () => {
    beforeEach(async () => {
      await serviceClient.from('applicant_whatsapp_consents').insert({
        application_id: applicationId,
        org_id: orgId,
        phone: '+27821234567',
        opted_in_at: new Date().toISOString(),
        opted_out_at: new Date().toISOString(),
      });
    });

    it('dispatchApplicationApprovedWhatsApp is blocked', async () => {
      const result = await dispatchApplicationApprovedWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'WhatsApp Test Property — U1',
      });
      expect(result.sent).toBe(false);
      expect(result.eligibility).toEqual({ eligible: false, reason: 'opted_out' });
    });
  });

  describe('dispatch functions -- eligible (real consent on file), MockWhatsAppProvider', () => {
    beforeEach(async () => {
      await serviceClient.from('applicant_whatsapp_consents').insert({
        application_id: applicationId,
        org_id: orgId,
        phone: '+27821234567',
        opted_in_at: new Date().toISOString(),
      });
    });

    it('dispatchApplicationApprovedWhatsApp sends via the mock provider and writes one whatsapp_messages row', async () => {
      const result = await dispatchApplicationApprovedWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'WhatsApp Test Property — U1',
      });
      expect(result.eligibility.eligible).toBe(true);
      expect(result.sent).toBe(true);
      expect(result.deliveryConfigured).toBe(false); // no real Meta credentials in this test env

      const { data: messages } = await serviceClient
        .from('whatsapp_messages')
        .select('template_name, to_number, related_entity_type, related_entity_id')
        .eq('org_id', orgId);
      expect(messages!.length).toBe(1);
      expect(messages![0]!.template_name).toBe('application_approved');
      expect(messages![0]!.to_number).toBe('+27821234567');
      expect(messages![0]!.related_entity_type).toBe('applications');
      expect(messages![0]!.related_entity_id).toBe(applicationId);
    });

    it('a second, duplicate dispatch of the same event for the same application does not send twice', async () => {
      const first = await dispatchApplicationApprovedWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'WhatsApp Test Property — U1',
      });
      const second = await dispatchApplicationApprovedWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'WhatsApp Test Property — U1',
      });
      expect(first.sent).toBe(true);
      expect(second.sent).toBe(false);
      expect(second.reason).toBe('already_sent');

      const { count } = await serviceClient
        .from('whatsapp_messages')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('template_name', 'application_approved');
      expect(count).toBe(1);
    });

    it('a retry after a transient failure is not blocked by the duplicate-send guard (different template/event still eligible)', async () => {
      // application_approved and application_declined are mutually exclusive in real usage (an
      // application is decided one way or the other), but at the dispatch layer they're
      // independent (relatedEntityType, relatedEntityId, templateName) keys -- proves the
      // idempotency guard is scoped per-template, not a blanket per-application lock that would
      // wrongly prevent a legitimate retry of a DIFFERENT event for the same application.
      const approved = await dispatchApplicationApprovedWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'WhatsApp Test Property — U1',
      });
      const declined = await dispatchApplicationDeclinedWhatsApp(serviceClient, {
        orgId,
        applicationId,
        propertyLabel: 'WhatsApp Test Property — U1',
      });
      expect(approved.sent).toBe(true);
      expect(declined.sent).toBe(true);

      const { count } = await serviceClient
        .from('whatsapp_messages')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId);
      expect(count).toBe(2);
    });
  });
});

describeIfSupabase('dispatchLeaseReadyWhatsApp (real local Supabase integration, mock provider)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let propertyId: string;
  let unitId: string;
  let applicationId: string;
  let leaseId: string;

  beforeEach(async () => {
    const { data: org } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Lease WhatsApp Vitest Org ${Date.now()}`, org_type: 'agency' })
      .select('id')
      .single();
    orgId = org!.id;

    const { data: property } = await serviceClient
      .from('properties')
      .insert({ org_id: orgId, nickname: 'Lease WhatsApp Property', address_line1: '1 Test St', city: 'Cape Town', country: 'ZA', property_type: 'house' })
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
      .insert({ org_id: orgId, property_id: propertyId, unit_id: unitId, applicant_name: 'Lease WhatsApp Applicant', status: 'invited' })
      .select('id')
      .single();
    applicationId = application!.id;

    const { data: lease } = await serviceClient
      .from('leases')
      .insert({
        org_id: orgId,
        unit_id: unitId,
        start_date: new Date().toISOString().slice(0, 10),
        rent_amount: 0,
        deposit_amount: 0,
        status: 'draft',
        source: 'application_approved',
        source_application_id: applicationId,
      })
      .select('id')
      .single();
    leaseId = lease!.id;
  });

  afterEach(async () => {
    await serviceClient.from('applicant_whatsapp_consents').delete().eq('application_id', applicationId);
    await serviceClient.from('whatsapp_messages').delete().eq('org_id', orgId);
    await serviceClient.from('leases').delete().eq('id', leaseId);
    await serviceClient.from('applications').delete().eq('id', applicationId);
    await serviceClient.from('units').delete().eq('id', unitId);
    await serviceClient.from('properties').delete().eq('id', propertyId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
  });

  it('is never eligible for a manual lease (no source_application_id) -- no consent record could ever exist for it', async () => {
    const { data: manualLease } = await serviceClient
      .from('leases')
      .insert({
        org_id: orgId,
        unit_id: unitId,
        start_date: new Date().toISOString().slice(0, 10),
        rent_amount: 0,
        deposit_amount: 0,
        status: 'draft',
        source: 'manual',
      })
      .select('id')
      .single();

    const { dispatchLeaseReadyWhatsApp } = await import('../leaseNotifications');
    const result = await dispatchLeaseReadyWhatsApp(manualLease!.id);
    expect(result).toEqual({ eligible: false, sent: false });

    await serviceClient.from('leases').delete().eq('id', manualLease!.id);
  });

  it('is not eligible when the source application has no WhatsApp consent on file', async () => {
    const { dispatchLeaseReadyWhatsApp } = await import('../leaseNotifications');
    const result = await dispatchLeaseReadyWhatsApp(leaseId);
    expect(result).toEqual({ eligible: false, sent: false });

    const { data: messages } = await serviceClient.from('whatsapp_messages').select('id').eq('org_id', orgId);
    expect(messages).toEqual([]);
  });

  it('sends via the mock provider once the source application has real, unrevoked consent', async () => {
    await serviceClient.from('applicant_whatsapp_consents').insert({
      application_id: applicationId,
      org_id: orgId,
      phone: '+27821234567',
      opted_in_at: new Date().toISOString(),
    });

    const { dispatchLeaseReadyWhatsApp } = await import('../leaseNotifications');
    const result = await dispatchLeaseReadyWhatsApp(leaseId);
    expect(result.eligible).toBe(true);
    expect(result.sent).toBe(true);

    const { data: messages } = await serviceClient
      .from('whatsapp_messages')
      .select('template_name, related_entity_type, related_entity_id')
      .eq('org_id', orgId);
    expect(messages!.length).toBe(1);
    expect(messages![0]!.template_name).toBe('lease_ready');
    expect(messages![0]!.related_entity_type).toBe('leases');
    expect(messages![0]!.related_entity_id).toBe(leaseId);
  });

  it('does not send twice for a resend of the same lease', async () => {
    await serviceClient.from('applicant_whatsapp_consents').insert({
      application_id: applicationId,
      org_id: orgId,
      phone: '+27821234567',
      opted_in_at: new Date().toISOString(),
    });

    const { dispatchLeaseReadyWhatsApp } = await import('../leaseNotifications');
    const first = await dispatchLeaseReadyWhatsApp(leaseId);
    const second = await dispatchLeaseReadyWhatsApp(leaseId);
    expect(first.sent).toBe(true);
    expect(second.sent).toBe(false);

    const { count } = await serviceClient
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId);
    expect(count).toBe(1);
  });
});
