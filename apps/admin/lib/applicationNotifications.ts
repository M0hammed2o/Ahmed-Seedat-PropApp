import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchWhatsApp, type DispatchWhatsAppResult } from '@/lib/whatsappDispatch';
import { resolveOrgWhatsAppBranding } from '@/lib/whatsappDispatch';
import {
  buildApplicationInvitationVariables,
  buildApplicationDocumentsRequestedVariables,
  buildApplicationApprovedVariables,
  buildApplicationDeclinedVariables,
} from '@/lib/whatsappTemplateVariables';

// First-tenant-workflow predeploy pass (WORKLOG.md 2026-08-25), Phase 6-8: application WhatsApp
// events. Code-ready, mock-testable -- none of these templates are approved in Meta yet
// (whatsappTemplates.ts), so dispatchWhatsApp() itself already refuses a real send. What this file
// adds on top is the affirmative-consent gate (Phase 7): unlike every other WhatsApp trigger in
// this codebase, an applicant has no auth.users identity and therefore no notification_preferences
// row for dispatchWhatsApp()'s own opt-out check to read -- the real gate here is
// applicant_whatsapp_consents (migration 20260101000135), checked explicitly, BEFORE
// dispatchWhatsApp() is ever called at all. No consent recorded, or an explicit opt-out
// (opted_out_at set) -- eligible: false, and the Meta call never happens, not even a
// template-not-approved attempt.

export interface ApplicantWhatsAppEligibility {
  eligible: boolean;
  reason?: 'no_consent' | 'opted_out' | 'no_phone';
  phone?: string;
}

export async function checkApplicantWhatsAppEligibility(
  serviceClient: SupabaseClient,
  applicationId: string,
): Promise<ApplicantWhatsAppEligibility> {
  const { data: consent } = await serviceClient
    .from('applicant_whatsapp_consents')
    .select('phone, opted_out_at')
    .eq('application_id', applicationId)
    .maybeSingle();
  if (!consent) return { eligible: false, reason: 'no_consent' };
  if (consent.opted_out_at) return { eligible: false, reason: 'opted_out' };
  if (!consent.phone) return { eligible: false, reason: 'no_phone' };
  return { eligible: true, phone: consent.phone };
}

interface ApplicationWhatsAppContext {
  orgId: string;
  applicationId: string;
  propertyLabel: string;
  applyUrl?: string;
}

async function dispatchIfEligible(
  serviceClient: SupabaseClient,
  ctx: ApplicationWhatsAppContext,
  templateName: 'application_invitation' | 'application_documents_requested' | 'application_approved' | 'application_declined',
  variables: Record<string, string>,
): Promise<DispatchWhatsAppResult & { eligibility: ApplicantWhatsAppEligibility }> {
  const eligibility = await checkApplicantWhatsAppEligibility(serviceClient, ctx.applicationId);
  if (!eligibility.eligible) {
    return { sent: false, reason: 'no_phone', deliveryConfigured: false, eligibility };
  }
  const result = await dispatchWhatsApp(serviceClient, {
    orgId: ctx.orgId,
    toPhone: eligibility.phone ?? null,
    templateName,
    variables,
    relatedEntityType: 'applications',
    relatedEntityId: ctx.applicationId,
    actorUserId: null,
  });
  return { ...result, eligibility };
}

export async function dispatchApplicationInvitationWhatsApp(
  serviceClient: SupabaseClient,
  ctx: ApplicationWhatsAppContext,
) {
  const branding = await resolveOrgWhatsAppBranding(serviceClient, ctx.orgId);
  return dispatchIfEligible(
    serviceClient,
    ctx,
    'application_invitation',
    buildApplicationInvitationVariables({
      organizationName: branding.organizationName,
      propertyLabel: ctx.propertyLabel,
      applyUrl: ctx.applyUrl ?? '',
    }),
  );
}

export async function dispatchApplicationDocumentsRequestedWhatsApp(
  serviceClient: SupabaseClient,
  ctx: ApplicationWhatsAppContext,
) {
  const branding = await resolveOrgWhatsAppBranding(serviceClient, ctx.orgId);
  return dispatchIfEligible(
    serviceClient,
    ctx,
    'application_documents_requested',
    buildApplicationDocumentsRequestedVariables({
      organizationName: branding.organizationName,
      propertyLabel: ctx.propertyLabel,
      applyUrl: ctx.applyUrl ?? '',
    }),
  );
}

export async function dispatchApplicationApprovedWhatsApp(
  serviceClient: SupabaseClient,
  ctx: ApplicationWhatsAppContext,
) {
  const branding = await resolveOrgWhatsAppBranding(serviceClient, ctx.orgId);
  return dispatchIfEligible(
    serviceClient,
    ctx,
    'application_approved',
    buildApplicationApprovedVariables({ organizationName: branding.organizationName, propertyLabel: ctx.propertyLabel }),
  );
}

export async function dispatchApplicationDeclinedWhatsApp(
  serviceClient: SupabaseClient,
  ctx: ApplicationWhatsAppContext,
) {
  const branding = await resolveOrgWhatsAppBranding(serviceClient, ctx.orgId);
  return dispatchIfEligible(
    serviceClient,
    ctx,
    'application_declined',
    buildApplicationDeclinedVariables({ organizationName: branding.organizationName, propertyLabel: ctx.propertyLabel }),
  );
}
