import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// dispatchLeaseReadyEmail/dispatchLeaseReadyWhatsApp call getServiceRoleClient() internally
// (unlike applicationNotifications.ts's functions, which take a client parameter) -- its env
// validation needs these set before the module is ever imported, same as every route test in this
// repo that exercises a real service-role code path.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const { dispatchLeaseReadyEmail, dispatchLeaseReadyWhatsApp } = await import('../leaseNotifications');

// WhatsApp launch-completion pass (WORKLOG.md 2026-08-27), Section 18: "An imported EXISTING lease
// must NOT dispatch lease_ready." dispatchLeaseReadyWhatsApp already correctly gated this on
// lease.source_application_id (a manual/imported lease has none); dispatchLeaseReadyEmail did NOT
// have the same gate until this same pass added it -- these tests prove both channels now agree:
// an application-approved lease (source_application_id set) is eligible for lease_ready on both
// channels; a manual/imported lease (source_application_id null) gets neither, ever.

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

describeIfSupabase('leaseNotifications -- lease_ready (real local Supabase integration, MockWhatsAppProvider)', () => {
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let orgId: string;
  let propertyId: string;
  let unitId: string;
  let applicationId: string;
  let tenantId: string;
  let appApprovedLeaseId: string;
  let manualLeaseId: string;

  beforeEach(async () => {
    const { data: org } = await serviceClient
      .from('organizations')
      .insert({ legal_name: `Lease Notify Vitest Org ${Date.now()}`, org_type: 'agency' })
      .select('id')
      .single();
    orgId = org!.id;

    const { data: property } = await serviceClient
      .from('properties')
      .insert({ org_id: orgId, nickname: 'Lease Notify Property', address_line1: '1 Test St', city: 'Cape Town', country: 'ZA', property_type: 'house' })
      .select('id')
      .single();
    propertyId = property!.id;

    const { data: units } = await serviceClient
      .from('units')
      .insert([
        { property_id: propertyId, org_id: orgId, unit_label: 'U-App', status: 'vacant' },
        { property_id: propertyId, org_id: orgId, unit_label: 'U-Manual', status: 'vacant' },
      ])
      .select('id, unit_label');
    unitId = units!.find((u) => u.unit_label === 'U-App')!.id;
    const manualUnitId = units!.find((u) => u.unit_label === 'U-Manual')!.id;

    const { data: application } = await serviceClient
      .from('applications')
      .insert({
        org_id: orgId,
        property_id: propertyId,
        unit_id: unitId,
        applicant_name: 'Lease Notify Applicant',
        applicant_email: 'lease-notify-applicant@example.com',
        status: 'submitted',
      })
      .select('id')
      .single();
    applicationId = application!.id;

    await serviceClient.from('applicant_whatsapp_consents').insert({
      application_id: applicationId,
      org_id: orgId,
      phone: '+27821234567',
    });

    const { data: tenant } = await serviceClient
      .from('tenants')
      .insert({ org_id: orgId, full_name: 'Lease Notify Tenant', email: 'lease-notify-tenant@example.com', status: 'pending' })
      .select('id')
      .single();
    tenantId = tenant!.id;

    const { data: appLease } = await serviceClient
      .from('leases')
      .insert({
        org_id: orgId,
        unit_id: unitId,
        start_date: '2026-09-01',
        rent_amount: 10000,
        status: 'draft',
        source: 'application_approved',
        source_application_id: applicationId,
      })
      .select('id')
      .single();
    appApprovedLeaseId = appLease!.id;
    await serviceClient.from('lease_tenants').insert({ lease_id: appApprovedLeaseId, tenant_id: tenantId, is_primary: true });

    const { data: manLease } = await serviceClient
      .from('leases')
      .insert({
        org_id: orgId,
        unit_id: manualUnitId,
        start_date: '2026-01-01',
        rent_amount: 9000,
        status: 'draft',
        source: 'manual',
      })
      .select('id')
      .single();
    manualLeaseId = manLease!.id;
    await serviceClient.from('lease_tenants').insert({ lease_id: manualLeaseId, tenant_id: tenantId, is_primary: true });
  });

  afterEach(async () => {
    await serviceClient.from('whatsapp_messages').delete().eq('org_id', orgId);
    await serviceClient.from('email_messages').delete().eq('org_id', orgId);
    await serviceClient.from('lease_tenants').delete().in('lease_id', [appApprovedLeaseId, manualLeaseId]);
    await serviceClient.from('leases').delete().in('id', [appApprovedLeaseId, manualLeaseId]);
    await serviceClient.from('applicant_whatsapp_consents').delete().eq('application_id', applicationId);
    await serviceClient.from('applications').delete().eq('id', applicationId);
    await serviceClient.from('tenants').delete().eq('id', tenantId);
    await serviceClient.from('units').delete().eq('property_id', propertyId);
    await serviceClient.from('properties').delete().eq('id', propertyId);
    await serviceClient.from('organizations').delete().eq('id', orgId);
  });

  describe('an application-approved lease (real, freshly-agreed tenancy) is eligible for lease_ready on both channels', () => {
    it('dispatchLeaseReadyEmail sends', async () => {
      const result = await dispatchLeaseReadyEmail(serviceClient, appApprovedLeaseId);
      expect(result.sent).toBe(true);
    });

    it('dispatchLeaseReadyWhatsApp sends', async () => {
      const result = await dispatchLeaseReadyWhatsApp(appApprovedLeaseId);
      expect(result.eligible).toBe(true);
      expect(result.sent).toBe(true);
    });
  });

  describe('an imported/manual lease (already physically signed) NEVER gets lease_ready on either channel', () => {
    it('dispatchLeaseReadyEmail does not send -- reason: not_applicable', async () => {
      const result = await dispatchLeaseReadyEmail(serviceClient, manualLeaseId);
      expect(result.sent).toBe(false);
      expect(result.reason).toBe('not_applicable');
    });

    it('dispatchLeaseReadyWhatsApp does not send -- eligible: false, never even reaches the consent/provider check', async () => {
      const result = await dispatchLeaseReadyWhatsApp(manualLeaseId);
      expect(result.eligible).toBe(false);
      expect(result.sent).toBe(false);
    });

    it('no whatsapp_messages or email_messages row is ever created for the manual lease', async () => {
      await dispatchLeaseReadyEmail(serviceClient, manualLeaseId);
      await dispatchLeaseReadyWhatsApp(manualLeaseId);

      const { count: waCount } = await serviceClient
        .from('whatsapp_messages')
        .select('id', { count: 'exact', head: true })
        .eq('related_entity_type', 'leases')
        .eq('related_entity_id', manualLeaseId);
      expect(waCount).toBe(0);

      const { count: emailCount } = await serviceClient
        .from('email_messages')
        .select('id', { count: 'exact', head: true })
        .eq('related_entity_type', 'leases')
        .eq('related_entity_id', manualLeaseId);
      expect(emailCount).toBe(0);
    });
  });
});
