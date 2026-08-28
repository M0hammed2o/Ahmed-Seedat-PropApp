import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceRoleClient } from '@/lib/supabase/server';
import { dispatchEmail, type DispatchEmailResult } from '@/lib/emailDispatch';
import { dispatchWhatsApp, resolveOrgWhatsAppBranding, type DispatchWhatsAppResult } from '@/lib/whatsappDispatch';
import { buildLeaseReadyVariables } from '@/lib/whatsappTemplateVariables';
import { checkApplicantWhatsAppEligibility } from '@/lib/applicationNotifications';
import { getAppUrl } from '@/lib/appUrl';

// Applicant->tenant->lease V1 continuation (WORKLOG.md 2026-08-25), Phase T: lease_ready
// notification, dispatched from POST /api/v1/leases/:id/send. Uses the existing tenant-portal
// /my-lease route (RLS-protected, session-authenticated) as the "secure portal link" -- never a
// raw storage path or a long-lived signed URL embedded in the email itself, matching
// tenant_invitation/WHATSAPP.md's own "no sensitive detail before identity is established"
// discipline and this task's explicit "never expose Storage path or permanent signed URL" rule.

/** Loads exactly what the lease_ready email needs and dispatches it -- idempotent via
 * dispatchEmail's own (relatedEntityType, relatedEntityId, templateName) check, so a resend of an
 * already-sent lease never double-emails. Returns a result even when there's no primary tenant
 * email on file (sent: false, reason: 'no_address') rather than throwing -- the lease send itself
 * must not fail just because notification couldn't be delivered.
 *
 * WhatsApp launch-completion pass (WORKLOG.md 2026-08-27): mirrors dispatchLeaseReadyWhatsApp's
 * own source_application_id gate below, which this email version was missing -- an imported
 * existing tenancy (source: 'manual', no source_application_id) already has a physically signed
 * lease; "Your lease is ready for signature" is factually wrong for it, not just an unapproved
 * WhatsApp template. send_lease() itself does not reject a manual lease (its own approval check is
 * skipped when source_application_id is null), so this gate is the only thing standing between the
 * existing "Prepare lease" UI (currently shown for every draft lease regardless of source) and a
 * genuinely misleading email reaching an already-signed tenant. */
export async function dispatchLeaseReadyEmail(
  _sessionClient: SupabaseClient,
  leaseId: string,
): Promise<DispatchEmailResult> {
  const serviceClient = getServiceRoleClient();

  const { data: lease, error: leaseError } = await serviceClient
    .from('leases')
    .select(
      'id, org_id, unit_id, source_application_id, organizations(trading_name, legal_name), units(unit_label, property_id, properties(nickname))',
    )
    .eq('id', leaseId)
    .maybeSingle();
  if (leaseError || !lease) {
    return { sent: false, reason: 'no_address', deliveryConfigured: false };
  }
  if (!lease.source_application_id) {
    return { sent: false, reason: 'not_applicable', deliveryConfigured: false };
  }

  const { data: leaseTenant } = await serviceClient
    .from('lease_tenants')
    .select('tenants(email, full_name)')
    .eq('lease_id', leaseId)
    .eq('is_primary', true)
    .maybeSingle();

  const tenant = (leaseTenant as unknown as { tenants: { email: string | null; full_name: string } | null } | null)
    ?.tenants;
  const org = (lease as unknown as { organizations: { trading_name: string | null; legal_name: string } | null })
    .organizations;
  const unit = (lease as unknown as { units: { unit_label: string; properties: { nickname: string } | null } | null })
    .units;

  const orgName = org?.trading_name ?? org?.legal_name ?? 'Your landlord';
  const propertyLabel = unit?.properties?.nickname
    ? `${unit.properties.nickname} — ${unit.unit_label}`
    : (unit?.unit_label ?? 'your rental');

  return dispatchEmail(serviceClient, {
    orgId: (lease as { org_id: string }).org_id,
    toAddress: tenant?.email ?? null,
    templateName: 'lease_ready',
    templateVars: {
      orgName,
      propertyLabel,
      tenantName: tenant?.full_name,
      leaseUrl: `${getAppUrl()}/my-lease`,
    },
    relatedEntityType: 'leases',
    relatedEntityId: leaseId,
    actorUserId: null,
  });
}

/** Phase U: lease_ready WhatsApp -- eligibility follows the lease's own source_application_id (the
 * only place an affirmative WhatsApp consent can currently come from, Phase 7). A manual lease
 * (no source application) has no consent record to check against and is therefore never eligible
 * -- a real, disclosed V1 gap (no broader tenant-level WhatsApp consent flow yet), not a bug.
 * Not approved in Meta yet either way (whatsappTemplates.ts) -- dispatchWhatsApp() itself refuses
 * a real send regardless of eligibility. */
export async function dispatchLeaseReadyWhatsApp(
  leaseId: string,
): Promise<(DispatchWhatsAppResult & { eligible: boolean }) | { eligible: false; sent: false }> {
  const serviceClient = getServiceRoleClient();

  const { data: lease } = await serviceClient
    .from('leases')
    .select('org_id, source_application_id, units(unit_label, properties(nickname))')
    .eq('id', leaseId)
    .maybeSingle();
  if (!lease || !lease.source_application_id) {
    return { eligible: false, sent: false };
  }

  const eligibility = await checkApplicantWhatsAppEligibility(serviceClient, lease.source_application_id);
  if (!eligibility.eligible || !eligibility.phone) {
    return { eligible: false, sent: false };
  }

  const unit = (lease as unknown as { units: { unit_label: string; properties: { nickname: string } | null } | null }).units;
  const branding = await resolveOrgWhatsAppBranding(serviceClient, lease.org_id);
  const propertyLabel = unit?.properties?.nickname
    ? `${unit.properties.nickname} — ${unit.unit_label}`
    : (unit?.unit_label ?? 'your rental');

  const result = await dispatchWhatsApp(serviceClient, {
    orgId: lease.org_id,
    toPhone: eligibility.phone,
    templateName: 'lease_ready',
    variables: buildLeaseReadyVariables({
      organizationName: branding.organizationName,
      propertyLabel,
      leaseUrl: `${getAppUrl()}/my-lease`,
    }),
    relatedEntityType: 'leases',
    relatedEntityId: leaseId,
    actorUserId: null,
  });
  return { ...result, eligible: true };
}
