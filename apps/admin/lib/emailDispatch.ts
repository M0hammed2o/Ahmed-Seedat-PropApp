import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { branding } from '@propvault/config';
import { getEmailProvider } from './providers/email';
import { writeAuditEvent } from './audit';

// Wires the approved V1 notification catalogue (EMAIL.md §1) to the already-built EmailProvider
// (TASKS.md M16) -- the provider/schema layer existed with nothing calling it (TD-23). This is
// the one place every dispatch site calls into, so idempotency/suppression/preference/audit
// logic lives once, not duplicated per trigger site.
export type EmailTemplateName =
  | 'invoice_issued'
  | 'payment_recorded'
  | 'owner_statement_ready'
  | 'maintenance_update'
  | 'subscription_payment_issue'
  | 'subscription_suspended'
  | 'trial_expiring_soon'
  | 'member_invited'
  | 'tenant_invitation';

// Only categories with an existing notification_preferences row can be preference-gated
// (DATABASE.md §7's closed enum has no 'billing'/'accounting' category) -- invoice/payment/
// owner-statement/subscription emails are transactional (EMAIL.md §1: "not user-suppressible"),
// so they omit `category` entirely and are never gated. Only maintenance_update is gated here.
const TEMPLATE_CATEGORY: Partial<Record<EmailTemplateName, 'maintenance'>> = {
  maintenance_update: 'maintenance',
};

const TEMPLATE_SUBJECTS: Record<EmailTemplateName, (vars: Record<string, unknown>) => string> = {
  invoice_issued: (v) => `Invoice for ${v.propertyAddress ?? 'your rental'}`,
  payment_recorded: (v) => `Payment received — ${v.propertyAddress ?? 'your rental'}`,
  owner_statement_ready: (v) => `Your owner statement for ${v.period ?? 'this period'} is ready`,
  maintenance_update: (v) => `Maintenance update: ${v.summary ?? 'your ticket'}`,
  subscription_payment_issue: () => `Action needed: subscription payment issue`,
  subscription_suspended: (v) =>
    `Your ${branding.productName} access has been suspended (${v.reason ?? 'billing issue'})`,
  trial_expiring_soon: (v) =>
    `Your ${branding.productName} trial ends soon — ${v.legalName ?? 'your organization'}`,
  member_invited: (v) =>
    `You've been invited to join ${v.orgName ?? `a ${branding.productName} organization`}`,
  tenant_invitation: (v) =>
    `Activate your ${branding.productName} tenant portal for ${v.orgName ?? 'your rental'}`,
};

// Plain-text bodies, deliberately minimal (a real HTML/branded template pass is out of scope for
// this dispatch layer -- EMAIL.md doesn't specify one) -- one line per template, same
// vars-in/string-out shape as TEMPLATE_SUBJECTS, so a real provider (ResendEmailProvider) has
// actual content to send instead of a guessed convention. Never referenced by MockEmailProvider,
// which only logs; a real provider is the only consumer, matching how templateVars itself was
// unused by anything until a real provider needed real content.
const TEMPLATE_BODY: Record<EmailTemplateName, (vars: Record<string, unknown>) => string> = {
  invoice_issued: (v) =>
    `A new invoice is ready for ${v.propertyAddress ?? 'your rental'}. Sign in to ${branding.productName} to view and pay it.`,
  payment_recorded: (v) =>
    `We've recorded your payment for ${v.propertyAddress ?? 'your rental'}. Thank you.`,
  owner_statement_ready: (v) =>
    `Your owner statement for ${v.period ?? 'this period'} is ready to view in ${branding.productName}.`,
  maintenance_update: (v) =>
    `There's an update on your maintenance ticket: ${v.summary ?? `see ${branding.productName} for details`}.`,
  subscription_payment_issue: (v) =>
    `We couldn't process your subscription payment (reference ${v.providerReference ?? 'unknown'}). Please update your payment details in ${branding.productName} to avoid interruption.`,
  subscription_suspended: (v) =>
    `Your ${branding.productName} access has been suspended: ${v.reason ?? 'a billing issue'}. Sign in and visit Billing & subscription to restore access.`,
  trial_expiring_soon: (v) =>
    `Your ${branding.productName} trial for ${v.legalName ?? 'your organization'} ends on ${v.trialEndsAt ?? 'soon'}. Choose a plan to continue without interruption.`,
  member_invited: (v) =>
    `You've been invited to join ${v.orgName ?? `a ${branding.productName} organization`}. Sign in to ${branding.productName} to accept.`,
  tenant_invitation: (v) =>
    `Activate your ${branding.productName} tenant portal for ${v.orgName ?? 'your rental'} to view your lease, payments, and submit maintenance requests.`,
};

export interface DispatchEmailInput {
  orgId: string;
  toAddress: string | null;
  toUserId?: string | null;
  templateName: EmailTemplateName;
  templateVars: Record<string, unknown>;
  relatedEntityType: string;
  relatedEntityId: string;
  actorUserId: string | null;
}

export interface DispatchEmailResult {
  sent: boolean;
  reason?: 'no_address' | 'suppressed' | 'preference_disabled' | 'already_sent';
  emailMessageId?: string;
}

/**
 * Idempotent, preference-aware, suppression-aware email dispatch. Every real trigger site in
 * this codebase calls this instead of the raw EmailProvider, so "no duplicate sends" and "check
 * preferences/suppressions first" are enforced once, not per call site.
 */
export async function dispatchEmail(
  serviceClient: SupabaseClient,
  input: DispatchEmailInput,
): Promise<DispatchEmailResult> {
  if (!input.toAddress) {
    return { sent: false, reason: 'no_address' };
  }

  // Idempotency: one email per (related_entity_type, related_entity_id, template_name) --
  // re-triggering the same event (e.g. a route retried after a network blip) never double-sends.
  const { data: existing } = await serviceClient
    .from('email_messages')
    .select('id')
    .eq('related_entity_type', input.relatedEntityType)
    .eq('related_entity_id', input.relatedEntityId)
    .eq('template_name', input.templateName)
    .maybeSingle();
  if (existing) {
    return { sent: false, reason: 'already_sent', emailMessageId: existing.id };
  }

  const { data: suppression } = await serviceClient
    .from('email_suppressions')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('email_address', input.toAddress)
    .maybeSingle();
  if (suppression) {
    return { sent: false, reason: 'suppressed' };
  }

  const category = TEMPLATE_CATEGORY[input.templateName];
  if (category && input.toUserId) {
    const { data: pref } = await serviceClient
      .from('notification_preferences')
      .select('email_enabled')
      .eq('user_id', input.toUserId)
      .eq('category', category)
      .maybeSingle();
    // Missing row = default enabled (notification_preferences.email_enabled defaults to true) --
    // a recipient with no explicit preference row has never opted out.
    if (pref && pref.email_enabled === false) {
      return { sent: false, reason: 'preference_disabled' };
    }
  }

  const provider = getEmailProvider();
  const subject = TEMPLATE_SUBJECTS[input.templateName](input.templateVars);
  const bodyText = TEMPLATE_BODY[input.templateName](input.templateVars);
  const result = await provider.send({
    orgId: input.orgId,
    toAddress: input.toAddress,
    templateName: input.templateName,
    templateVars: input.templateVars,
    subject,
    bodyText,
    relatedEntityType: input.relatedEntityType,
    relatedEntityId: input.relatedEntityId,
  });

  const { data: message, error: insertError } = await serviceClient
    .from('email_messages')
    .insert({
      org_id: input.orgId,
      to_address: input.toAddress,
      subject,
      template_name: input.templateName,
      related_entity_type: input.relatedEntityType,
      related_entity_id: input.relatedEntityId,
      status: result.status,
      provider_message_id: result.providerMessageId,
    })
    .select('id')
    .single();
  if (insertError) throw new Error(insertError.message);

  await writeAuditEvent(serviceClient, {
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    actorType: input.actorUserId ? 'user' : 'system',
    action: 'email_sent',
    entityType: input.relatedEntityType,
    entityId: input.relatedEntityId,
    after: { templateName: input.templateName, toAddress: input.toAddress, status: result.status },
  });

  return { sent: true, emailMessageId: message.id };
}
