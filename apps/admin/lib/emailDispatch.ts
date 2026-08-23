import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailWebhookHeaders } from '@propvault/types';
import { branding } from '@propvault/config';
import { getEmailProvider, isEmailProviderConfigured } from './providers/email';
import { renderEmailLayout, type EmailContent } from './email/layout';
import { writeAuditEvent } from './audit';
import { getAppUrl } from './appUrl';

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
  | 'tenant_invitation'
  | 'owner_invitation'
  | 'compliance_requirement_assigned'
  | 'compliance_requirement_acknowledged'
  | 'compliance_requirement_due_soon'
  | 'compliance_requirement_overdue'
  // V1 communications productionisation (WORKLOG.md this date): 5 real billing-lifecycle events
  // that RELEASE A's own proration engine already triggers (organization_subscriptions/
  // billing_plan_changes state transitions, migration 20260101000104) but never notified the
  // customer about -- confirmed by grep before this pass: zero dispatchEmail() calls existed
  // anywhere in lib/billing.ts or the billing routes for activation/upgrade/downgrade/
  // cancellation/reactivation, only for payment failure and suspension. Wired into the exact
  // points those state transitions already happen -- no new business logic, only notification of
  // existing logic.
  | 'subscription_activated'
  | 'plan_upgraded'
  | 'plan_downgrade_scheduled'
  | 'subscription_cancelled'
  | 'subscription_reactivated'
  // WhatsApp V1 completion pass, Phase F (WORKLOG.md this date): the OTP delivery channel for
  // phone-verification challenges (migration 20260101000106's request_phone_verification()).
  // WhatsApp itself would need a Meta Authentication-category template (distinct from the 8
  // Utility templates currently in review) to deliver an OTP -- deliberately not built; email is
  // the "already-supported secure verification channel" this pass was explicitly told to use
  // instead, per its own instruction not to invent a WhatsApp Authentication template.
  | 'phone_verification_code'
  // Provisioned-staff account model (this date): distinct from member_invited (the legacy
  // organization_invites self-service flow, left fully intact) -- staff_activation goes to a
  // brand-new or previously-passwordless identity and carries a GoTrue-issued activation link
  // (set-password, no plaintext credential ever included); staff_added_existing_user goes to an
  // already password-capable Proplyst account, which provision_staff_member() activates
  // immediately with no password/activation step, so this is a notification, not an invitation.
  | 'staff_activation'
  | 'staff_added_existing_user';

// Only categories with an existing notification_preferences row can be preference-gated
// (DATABASE.md §7's closed enum has no 'billing'/'accounting' category) -- invoice/payment/
// owner-statement/subscription emails are transactional (EMAIL.md §1: "not user-suppressible"),
// so they omit `category` entirely and are never gated. Only maintenance_update is gated here.
//
// Property compliance workflow, notification lifecycle completion (WORKLOG.md this date,
// migration 20260101000098 added the 'compliance' category): compliance_requirement_assigned
// stays deliberately ungated (same reasoning tenant_invitation already documents -- a recipient
// can't meaningfully opt out of the one message telling them action is required). The three new
// ones ARE genuinely opt-out-able conveniences (a staff FYI, and reminders for something the
// recipient already knows is outstanding), so they're gated like maintenance_update.
//
// The 5 new billing-lifecycle templates are deliberately UNGATED (no category entry) -- same
// "transactional, not user-suppressible" posture as subscription_payment_issue/
// subscription_suspended above: a customer cannot opt out of being told their own subscription
// was upgraded/downgraded/cancelled/reactivated, since that's evidence of a real account/money
// event, not a convenience notification.
const TEMPLATE_CATEGORY: Partial<Record<EmailTemplateName, 'maintenance' | 'compliance'>> = {
  maintenance_update: 'maintenance',
  compliance_requirement_acknowledged: 'compliance',
  compliance_requirement_due_soon: 'compliance',
  compliance_requirement_overdue: 'compliance',
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
    v.inviterName
      ? `${v.inviterName} invited you to join ${v.orgName ?? `a ${branding.productName} organization`} on ${branding.productName}`
      : `You've been invited to join ${v.orgName ?? `a ${branding.productName} organization`} on ${branding.productName}`,
  tenant_invitation: (v) =>
    `Activate your ${branding.productName} tenant portal for ${v.orgName ?? 'your rental'}`,
  owner_invitation: (v) =>
    `You've been invited to access your properties on ${v.orgName ?? branding.productName}`,
  compliance_requirement_assigned: (v) =>
    `Action required: ${v.ruleTitle ?? 'a rule'} for ${v.propertyLabel ?? 'your rental'}`,
  compliance_requirement_acknowledged: (v) =>
    `${v.tenantName ?? 'A tenant'} acknowledged ${v.ruleTitle ?? 'a rule'}`,
  compliance_requirement_due_soon: (v) =>
    `Reminder: ${v.ruleTitle ?? 'a rule'} for ${v.propertyLabel ?? 'your rental'} is due soon`,
  compliance_requirement_overdue: (v) =>
    `Overdue: ${v.ruleTitle ?? 'a rule'} for ${v.propertyLabel ?? 'your rental'}`,
  subscription_activated: (v) =>
    `Your ${branding.productName} subscription is active — welcome to ${v.planName ?? 'your plan'}`,
  plan_upgraded: (v) => `You've upgraded to the ${v.planName ?? 'new'} plan`,
  plan_downgrade_scheduled: (v) => `Your plan change to ${v.planName ?? 'a new plan'} is scheduled`,
  subscription_cancelled: () => `Your ${branding.productName} subscription has been cancelled`,
  subscription_reactivated: () =>
    `Welcome back — your ${branding.productName} subscription is active again`,
  phone_verification_code: (v) => `Your ${branding.productName} verification code: ${v.code ?? ''}`,
  staff_activation: (v) =>
    `You've been added to ${v.orgName ?? 'an organization'} on ${branding.productName}`,
  staff_added_existing_user: (v) =>
    `You've been added to ${v.orgName ?? 'an organization'} on ${branding.productName}`,
};

// Plain-text bodies -- the required MIME text/plain fallback for every real send (never removed
// in favor of HTML-only, per this task's own explicit requirement). Renders identically to before
// this pass for the 14 pre-existing templates; the 5 new ones follow the exact same
// vars-in/string-out shape.
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
    `${v.inviteeName ? `Hi ${v.inviteeName}, ` : ''}${v.inviterName ?? 'A team administrator'} invited you to join ${v.orgName ?? `a ${branding.productName} organization`} on ${branding.productName} as ${v.role ?? 'a team member'}. ${v.acceptUrl ? `Accept your invitation: ${v.acceptUrl}. ` : ''}${v.expiresAt ? `This invitation expires on ${v.expiresAt}. ` : ''}If you weren't expecting this, you can safely ignore this email.`,
  tenant_invitation: (v) =>
    `You've been invited to ${branding.productName} by ${v.orgName ?? 'your landlord'} to activate your tenant portal, where you can view your lease, payments, and submit maintenance requests. ${v.acceptUrl ? `Activate your account here: ${v.acceptUrl}. If you don't have a ${branding.productName} account yet, this link lets you create one. If you already have one, sign in with the same email address to link this tenancy to it. ` : ''}${v.expiresAt ? `This invitation expires on ${v.expiresAt}. ` : ''}If you weren't expecting this, you can safely ignore this email.`,
  owner_invitation: (v) =>
    `${v.ownerName ? `Hi ${v.ownerName}, ` : ''}${v.orgName ?? 'A managing organization'} has invited you to view your properties on ${branding.productName}. ${v.acceptUrl ? `Accept your invitation here: ${v.acceptUrl}. If you don't have a ${branding.productName} account yet, this link lets you create one. If you already have one, sign in with the same email address to link your properties to it. ` : ''}${v.expiresAt ? `This invitation expires on ${v.expiresAt}. ` : ''}If you weren't expecting this, you can safely ignore this email.`,
  compliance_requirement_assigned: (v) =>
    `${v.orgName ?? 'Your property manager'} has updated ${v.ruleTitle ?? 'a rule'} for ${v.propertyLabel ?? 'your rental'}. Please sign in to ${branding.productName} to review and acknowledge it.`,
  compliance_requirement_acknowledged: (v) =>
    `${v.tenantName ?? 'A tenant'} acknowledged ${v.ruleTitle ?? 'a rule'} (version ${v.versionNumber ?? ''}) for ${v.propertyLabel ?? 'a property'} on ${v.acknowledgedAt ?? 'recently'}.`,
  compliance_requirement_due_soon: (v) =>
    `${v.ruleTitle ?? 'A rule'} for ${v.propertyLabel ?? 'your rental'} is due ${v.dueAt ?? 'soon'}. Please sign in to ${branding.productName} to review and acknowledge it.`,
  compliance_requirement_overdue: (v) =>
    `${v.ruleTitle ?? 'A rule'} for ${v.propertyLabel ?? 'your rental'} was due ${v.dueAt ?? 'recently'} and is now overdue. Please sign in to ${branding.productName} to review and acknowledge it.`,
  subscription_activated: (v) =>
    `Your ${branding.productName} subscription is now active on the ${v.planName ?? ''} plan. You have full access to ${v.legalName ? `${v.legalName}'s` : "your organization's"} workspace.`,
  plan_upgraded: (v) =>
    `Your subscription has been upgraded to ${v.planName ?? 'a new plan'}, effective immediately. ${v.amountDueNow ? `An amount of ${v.amountDueNow} was charged for the remainder of this billing period. ` : ''}From your next renewal, you'll be charged ${v.nextRenewalAmount ?? 'the new plan price'}.`,
  plan_downgrade_scheduled: (v) =>
    `Your subscription is scheduled to change to ${v.planName ?? 'a new plan'} on ${v.effectiveAt ?? 'your next renewal date'}. You'll keep your current plan's full access until then, and no refund is issued for the remainder of this billing period.`,
  subscription_cancelled: (v) =>
    `Your ${branding.productName} subscription has been cancelled${v.periodEnd ? `, effective ${v.periodEnd}` : ''}. You can reactivate at any time from Billing & subscription.`,
  subscription_reactivated: (v) =>
    `Your ${branding.productName} subscription is active again on the ${v.planName ?? ''} plan. Welcome back.`,
  phone_verification_code: (v) =>
    `Your ${branding.productName} verification code is ${v.code ?? ''}. It expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
  staff_activation: (v) =>
    `You've been added to ${v.orgName ?? 'an organization'} on ${branding.productName} as ${v.role ?? 'a team member'}. ${v.activateUrl ? `Set your password to activate your account: ${v.activateUrl}. ` : ''}${v.expiresAt ? `This link expires on ${v.expiresAt}. ` : ''}If you weren't expecting this, you can safely ignore this email.`,
  staff_added_existing_user: (v) =>
    `You've been added to ${v.orgName ?? 'an organization'} on ${branding.productName} as ${v.role ?? 'a team member'}. Sign in to ${branding.productName} with your existing account to access it.`,
};

/**
 * V1 communications productionisation (WORKLOG.md this date). One structured content descriptor
 * per template -- lib/email/layout.ts's renderEmailLayout() is the ONLY place that turns this into
 * markup, so every template shares exactly one design (heading, intro, CTA button, info box,
 * footer), never a bespoke per-template HTML string. Deliberately mirrors TEMPLATE_SUBJECTS/
 * TEMPLATE_BODY's own vars-in/content-out shape, kept as its own map rather than merged into
 * TEMPLATE_BODY so the plain-text fallback stays simple, unstructured prose (what a plain-text
 * client needs) while the HTML gets real visual structure (what an HTML client can render).
 */
const TEMPLATE_HTML_CONTENT: Record<
  EmailTemplateName,
  (vars: Record<string, unknown>, appUrl: string) => EmailContent
> = {
  invoice_issued: (v, appUrl) => ({
    eyebrow: 'Rent invoice',
    heading: `Invoice for ${v.propertyAddress ?? 'your rental'}`,
    intro: `A new invoice is ready for ${v.propertyAddress ?? 'your rental'}.`,
    infoBox: v.amount
      ? { label: 'Amount due', text: `${v.amount}${v.period ? ` — ${v.period}` : ''}` }
      : undefined,
    cta: { label: `View invoice in ${branding.productName}`, url: `${appUrl}/my-payments` },
  }),
  payment_recorded: (v, appUrl) => ({
    eyebrow: 'Payment received',
    heading: 'Thank you — payment received',
    intro: `We've recorded your payment for ${v.propertyAddress ?? 'your rental'}.`,
    cta: { label: 'View payment history', url: `${appUrl}/my-payments` },
  }),
  owner_statement_ready: (v, appUrl) => ({
    eyebrow: 'Owner statement',
    heading: `Your statement for ${v.period ?? 'this period'} is ready`,
    intro: `Your owner statement for ${v.period ?? 'this period'} is ready to view.`,
    cta: { label: 'View owner statement', url: `${appUrl}/accounting` },
  }),
  maintenance_update: (v, appUrl) => ({
    eyebrow: 'Maintenance update',
    heading: 'There’s an update on your maintenance ticket',
    intro: String(v.summary ?? 'One of your maintenance tickets has a new update.'),
    cta: { label: 'View ticket', url: `${appUrl}/maintenance` },
  }),
  subscription_payment_issue: (v, appUrl) => ({
    eyebrow: 'Billing',
    heading: 'We couldn’t process your subscription payment',
    intro: `We were unable to process your subscription payment (reference ${v.providerReference ?? 'unknown'}).`,
    infoBox: {
      label: 'Action needed',
      text: 'Please update your payment details to avoid a loss of access.',
    },
    cta: { label: 'Update billing details', url: `${appUrl}/organization/billing` },
  }),
  subscription_suspended: (v, appUrl) => ({
    eyebrow: 'Account access',
    heading: `Your ${branding.productName} access has been suspended`,
    intro: `Your account access has been suspended: ${v.reason ?? 'a billing issue'}.`,
    cta: { label: 'Restore access', url: `${appUrl}/organization/billing` },
  }),
  trial_expiring_soon: (v, appUrl) => ({
    eyebrow: 'Trial ending',
    heading: 'Your trial ends soon',
    intro: `Your ${branding.productName} trial for ${v.legalName ?? 'your organization'} ends on ${v.trialEndsAt ?? 'soon'}.`,
    paragraphs: [
      'Choose a plan to continue without interruption to your properties, tenants, and records.',
    ],
    cta: { label: 'Choose a plan', url: `${appUrl}/organization/billing` },
  }),
  member_invited: (v, _appUrl) => ({
    eyebrow: 'Team invitation',
    heading: `You've been invited to join ${v.orgName ?? branding.productName}`,
    intro: `${v.inviterName ?? 'A team administrator'} invited you to join ${v.orgName ?? `a ${branding.productName} organization`} as ${v.role ?? 'a team member'}.`,
    infoBox: v.expiresAt
      ? { label: 'Expires', text: `This invitation expires on ${v.expiresAt}.` }
      : undefined,
    cta: v.acceptUrl ? { label: 'Accept invitation', url: String(v.acceptUrl) } : undefined,
    paragraphs: ["If you weren't expecting this, you can safely ignore this email."],
  }),
  tenant_invitation: (v, _appUrl) => ({
    eyebrow: 'Tenant portal invitation',
    heading: `Activate your tenant portal for ${v.orgName ?? 'your rental'}`,
    intro: `${v.orgName ?? 'Your landlord'} has invited you to activate your ${branding.productName} tenant portal, where you can view your lease, payments, and submit maintenance requests.`,
    paragraphs: [
      "If you don't have an account yet, this link lets you create one. If you already have one, sign in with the same email address to link this tenancy to it.",
      "If you weren't expecting this, you can safely ignore this email.",
    ],
    infoBox: v.expiresAt
      ? { label: 'Expires', text: `This invitation expires on ${v.expiresAt}.` }
      : undefined,
    // WHATSAPP.md §3's "never disclose lease terms/balances/sensitive detail before identity is
    // established" discipline applies equally here -- only the secure activation link, nothing
    // else about the tenancy itself.
    cta: v.acceptUrl ? { label: 'Activate your account', url: String(v.acceptUrl) } : undefined,
  }),
  owner_invitation: (v, _appUrl) => ({
    eyebrow: 'Owner portal invitation',
    heading: `You've been invited to view your properties on ${branding.productName}`,
    intro: `${v.orgName ?? 'A managing organization'} has invited you to view your properties on ${branding.productName}.`,
    paragraphs: [
      "If you don't have an account yet, this link lets you create one. If you already have one, sign in with the same email address to link your properties to it.",
      "If you weren't expecting this, you can safely ignore this email.",
    ],
    infoBox: v.expiresAt
      ? { label: 'Expires', text: `This invitation expires on ${v.expiresAt}.` }
      : undefined,
    cta: v.acceptUrl ? { label: 'Accept invitation', url: String(v.acceptUrl) } : undefined,
  }),
  compliance_requirement_assigned: (v, appUrl) => ({
    eyebrow: 'Action required',
    heading: String(v.ruleTitle ?? 'A rule requires your acknowledgement'),
    intro: `${v.orgName ?? 'Your property manager'} has updated ${v.ruleTitle ?? 'a rule'} for ${v.propertyLabel ?? 'your rental'}.`,
    cta: { label: 'Review and acknowledge', url: `${appUrl}/compliance` },
  }),
  compliance_requirement_acknowledged: (v, appUrl) => ({
    eyebrow: 'Compliance',
    heading: 'A tenant acknowledged a rule',
    intro: `${v.tenantName ?? 'A tenant'} acknowledged ${v.ruleTitle ?? 'a rule'}${v.versionNumber ? ` (version ${v.versionNumber})` : ''} for ${v.propertyLabel ?? 'a property'}.`,
    cta: { label: 'View compliance records', url: `${appUrl}/compliance` },
  }),
  compliance_requirement_due_soon: (v, appUrl) => ({
    eyebrow: 'Reminder',
    heading: String(v.ruleTitle ?? 'A rule is due soon'),
    intro: `${v.ruleTitle ?? 'A rule'} for ${v.propertyLabel ?? 'your rental'} is due ${v.dueAt ?? 'soon'}.`,
    cta: { label: 'Review and acknowledge', url: `${appUrl}/compliance` },
  }),
  compliance_requirement_overdue: (v, appUrl) => ({
    eyebrow: 'Overdue',
    heading: String(v.ruleTitle ?? 'A rule is overdue'),
    intro: `${v.ruleTitle ?? 'A rule'} for ${v.propertyLabel ?? 'your rental'} was due ${v.dueAt ?? 'recently'} and is now overdue.`,
    cta: { label: 'Review and acknowledge', url: `${appUrl}/compliance` },
  }),
  subscription_activated: (v, appUrl) => ({
    eyebrow: 'Subscription active',
    heading: `Welcome to ${v.planName ?? 'your plan'}`,
    intro: `Your ${branding.productName} subscription is now active${v.legalName ? ` for ${v.legalName}` : ''}.`,
    paragraphs: [
      'You now have full access to your workspace, including every feature included in your plan.',
    ],
    cta: { label: 'Go to dashboard', url: `${appUrl}/dashboard` },
  }),
  plan_upgraded: (v, appUrl) => ({
    eyebrow: 'Plan upgraded',
    heading: `You've upgraded to ${v.planName ?? 'a new plan'}`,
    intro: `Your subscription has been upgraded to ${v.planName ?? 'a new plan'}, effective immediately.`,
    infoBox: {
      label: 'Billing summary',
      text: `${v.amountDueNow ? `Due today: ${v.amountDueNow}. ` : ''}Next renewal: ${v.nextRenewalAmount ?? 'the new plan price'}.`,
    },
    cta: { label: 'View billing', url: `${appUrl}/organization/billing` },
  }),
  plan_downgrade_scheduled: (v, appUrl) => ({
    eyebrow: 'Plan change scheduled',
    heading: `Your plan will change to ${v.planName ?? 'a new plan'}`,
    intro: `Your subscription is scheduled to change to ${v.planName ?? 'a new plan'} on ${v.effectiveAt ?? 'your next renewal date'}.`,
    infoBox: {
      label: 'What stays the same until then',
      text: "You keep your current plan's full access until the change takes effect. No refund is issued for the remainder of this billing period.",
    },
    cta: { label: 'View or change this', url: `${appUrl}/organization/billing` },
  }),
  subscription_cancelled: (v, appUrl) => ({
    eyebrow: 'Subscription cancelled',
    heading: 'Your subscription has been cancelled',
    intro: `Your ${branding.productName} subscription has been cancelled${v.periodEnd ? `, effective ${v.periodEnd}` : ''}.`,
    paragraphs: ['You can reactivate at any time — your data is preserved.'],
    cta: { label: 'Reactivate subscription', url: `${appUrl}/organization/billing` },
  }),
  subscription_reactivated: (v, appUrl) => ({
    eyebrow: 'Welcome back',
    heading: 'Your subscription is active again',
    intro: `Your ${branding.productName} subscription is active again on the ${v.planName ?? ''} plan.`,
    cta: { label: 'Go to dashboard', url: `${appUrl}/dashboard` },
  }),
  phone_verification_code: (v) => ({
    eyebrow: 'Verification code',
    heading: 'Your verification code',
    intro: 'Use this code to verify your phone number:',
    infoBox: { label: 'Verification code', text: String(v.code ?? '') },
    paragraphs: [
      'This code expires in 10 minutes.',
      "If you didn't request this, you can safely ignore this email.",
    ],
  }),
  staff_activation: (v, _appUrl) => ({
    eyebrow: 'Staff account',
    heading: `You've been added to ${v.orgName ?? 'an organization'}`,
    intro: `You've been added to ${v.orgName ?? 'an organization'} on ${branding.productName} as ${v.role ?? 'a team member'}. Set your password to activate your account.`,
    infoBox: v.expiresAt
      ? { label: 'Expires', text: `This link expires on ${v.expiresAt}.` }
      : undefined,
    cta: v.activateUrl ? { label: 'Set your password', url: String(v.activateUrl) } : undefined,
    paragraphs: ["If you weren't expecting this, you can safely ignore this email."],
  }),
  staff_added_existing_user: (v, appUrl) => ({
    eyebrow: 'Staff account',
    heading: `You've been added to ${v.orgName ?? 'an organization'}`,
    intro: `You've been added to ${v.orgName ?? 'an organization'} on ${branding.productName} as ${v.role ?? 'a team member'}.`,
    paragraphs: ['Sign in with your existing account to access it.'],
    cta: { label: `Sign in to ${branding.productName}`, url: `${appUrl}/login` },
  }),
};

/** Renders a template's subject + plain-text body + HTML body ahead of dispatch -- exported (not
 * just used internally by dispatchEmail below) so tests can assert on real rendered content
 * without needing a live DB or a mocked provider. */
export function renderEmailTemplate(
  templateName: EmailTemplateName,
  vars: Record<string, unknown>,
  appUrl: string = getAppUrl(),
): { subject: string; bodyText: string; bodyHtml: string } {
  const subject = TEMPLATE_SUBJECTS[templateName](vars);
  return {
    subject,
    bodyText: TEMPLATE_BODY[templateName](vars),
    bodyHtml: renderEmailLayout(TEMPLATE_HTML_CONTENT[templateName](vars, appUrl)),
  };
}

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
  /** False whenever this dispatch went through MockEmailProvider (no RESEND_API_KEY/
   * RESEND_FROM_ADDRESS configured) -- `sent: true` alone was previously indistinguishable from
   * a real send, which is exactly how invitations could show "pending" with no email ever
   * actually leaving the server. Callers that give the user a "we emailed this" message must
   * check this, not just `sent`. */
  deliveryConfigured: boolean;
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
  const deliveryConfigured = isEmailProviderConfigured();

  if (!input.toAddress) {
    return { sent: false, reason: 'no_address', deliveryConfigured };
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
    return { sent: false, reason: 'already_sent', emailMessageId: existing.id, deliveryConfigured };
  }

  const { data: suppression } = await serviceClient
    .from('email_suppressions')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('email_address', input.toAddress)
    .maybeSingle();
  if (suppression) {
    return { sent: false, reason: 'suppressed', deliveryConfigured };
  }

  const category = TEMPLATE_CATEGORY[input.templateName];
  if (category) {
    // Org-level default (Phase 5, 20260101000093) checked first -- an org can turn a channel off
    // for every recipient in one place; the per-user check below can only narrow further, never
    // widen past what the org allows. Missing row = default enabled, same "no explicit row means
    // never opted out" convention the per-user table already uses.
    const { data: orgSetting } = await serviceClient
      .from('organization_notification_settings')
      .select('email_enabled')
      .eq('org_id', input.orgId)
      .eq('category', category)
      .maybeSingle();
    if (orgSetting && orgSetting.email_enabled === false) {
      return { sent: false, reason: 'preference_disabled', deliveryConfigured };
    }

    if (input.toUserId) {
      const { data: pref } = await serviceClient
        .from('notification_preferences')
        .select('email_enabled')
        .eq('user_id', input.toUserId)
        .eq('category', category)
        .maybeSingle();
      // Missing row = default enabled (notification_preferences.email_enabled defaults to true)
      // -- a recipient with no explicit preference row has never opted out.
      if (pref && pref.email_enabled === false) {
        return { sent: false, reason: 'preference_disabled', deliveryConfigured };
      }
    }
  }

  const provider = getEmailProvider();
  const { subject, bodyText, bodyHtml } = renderEmailTemplate(
    input.templateName,
    input.templateVars,
  );
  const result = await provider.send({
    orgId: input.orgId,
    toAddress: input.toAddress,
    templateName: input.templateName,
    templateVars: input.templateVars,
    subject,
    bodyText,
    bodyHtml,
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

  return { sent: true, emailMessageId: message.id, deliveryConfigured };
}

// Infrastructure-hardening pass (WORKLOG.md this date): closes the gap dispatchEmail() itself
// already documented -- "no provider webhook currently updates status afterward" -- so
// email_messages.status was permanently stuck at 'queued' for every real send. Mirrors
// processBillingWebhookEvent()'s exact idempotency pattern: verify signature, parse, insert into
// a dedicated *_webhook_events table with a unique(provider_name, provider_event_id) guard FIRST,
// treat a 23505 unique-violation as "already processed" (a provider retry) rather than an error,
// and only then touch the row(s) the event actually concerns.
export interface ProcessEmailWebhookResult {
  alreadyProcessed: boolean;
  eventType?: string;
}

// Forward-only status ranking (EMAIL.md-style "never let an old event un-deliver a delivered
// message"): once a message reaches a terminal rank, no further event may move it, regardless of
// arrival order. bounced/failed rank equal to delivered -- all three are equally terminal, just
// different terminal outcomes; none should ever overwrite another.
const STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  bounced: 2,
  failed: 2,
};

export async function processResendWebhookEvent(
  serviceClient: SupabaseClient,
  input: { rawBody: string; headers: EmailWebhookHeaders },
): Promise<ProcessEmailWebhookResult> {
  const provider = getEmailProvider();

  if (!provider.verifyWebhookSignature(input.rawBody, input.headers)) {
    throw new Error('Invalid webhook signature');
  }

  const event = provider.parseWebhookEvent(input.rawBody);
  // Prefer the real Svix delivery id (the true idempotency key) over parseWebhookEvent's
  // content-derived fallback -- always present in practice, since verifyWebhookSignature already
  // required headers.id to succeed.
  const providerEventId = input.headers.id ?? event.providerEventId;

  const { data: message } = await serviceClient
    .from('email_messages')
    .select('id, org_id, status')
    .eq('provider_message_id', event.providerMessageId)
    .maybeSingle();

  const { error: insertError } = await serviceClient.from('email_webhook_events').insert({
    org_id: message?.org_id ?? null,
    email_message_id: message?.id ?? null,
    provider_name: provider.providerName,
    provider_event_id: providerEventId,
    event_type: event.type,
    payload: event.raw as object,
  });
  if (insertError) {
    // 23505 = unique_violation -- this exact delivery was already processed, a provider retry.
    if (insertError.code === '23505') {
      return { alreadyProcessed: true, eventType: event.type };
    }
    throw new Error(insertError.message);
  }

  // An event for a provider_message_id this app never sent (wrong environment sharing the same
  // Resend account, a stale test, etc.) -- the raw event is still recorded above for audit, but
  // there is no local row to update. Not an error: the webhook was genuinely authentic, it just
  // doesn't concern us.
  if (!message) {
    return { alreadyProcessed: false, eventType: event.type };
  }

  if (event.type === 'sent' || event.type === 'delivered' || event.type === 'bounced') {
    const newStatus = event.type; // 'sent' | 'delivered' | 'bounced' are also EmailStatus values
    const currentRank = STATUS_RANK[message.status] ?? 0;
    const newRank = STATUS_RANK[newStatus] ?? 0;
    if (newRank >= currentRank && currentRank < 2) {
      const timestampColumn =
        newStatus === 'delivered' ? 'delivered_at' : newStatus === 'bounced' ? 'bounced_at' : null;
      await serviceClient
        .from('email_messages')
        .update({
          status: newStatus,
          provider_event_at: event.occurredAt,
          last_provider_event: event.type,
          ...(timestampColumn ? { [timestampColumn]: event.occurredAt } : {}),
          ...(newStatus === 'bounced' ? { failure_reason: event.bounceType ?? 'bounced' } : {}),
        })
        .eq('id', message.id);

      await writeAuditEvent(serviceClient, {
        orgId: message.org_id,
        actorUserId: null,
        actorType: 'system',
        action: 'email_status_updated',
        entityType: 'email_messages',
        entityId: message.id,
        after: { status: newStatus, providerEvent: event.type },
      });
    }
  } else {
    // delivery_delayed/complained/other -- informational, no status-enum transition, but still
    // worth a lightweight trail on the row itself for support/debugging.
    await serviceClient
      .from('email_messages')
      .update({ provider_event_at: event.occurredAt, last_provider_event: event.type })
      .eq('id', message.id);
  }

  // Hard bounce / spam complaint -> suppress future sends to this address, closing the gap
  // dispatchEmail() already reads from (email_suppressions) but nothing has ever written to.
  // Best-effort: never lets a suppression-write failure fail the whole webhook (already-committed
  // status update above matters more than this secondary effect).
  const isHardBounce =
    event.type === 'bounced' && (event.bounceType ?? '').toLowerCase().includes('permanent');
  if (isHardBounce || event.type === 'complained') {
    try {
      const { data: fullMessage } = await serviceClient
        .from('email_messages')
        .select('org_id, to_address')
        .eq('id', message.id)
        .single();
      if (fullMessage) {
        await serviceClient.from('email_suppressions').upsert(
          {
            org_id: fullMessage.org_id,
            email_address: fullMessage.to_address,
            reason: event.type === 'complained' ? 'spam_complaint' : 'hard_bounce',
          },
          { onConflict: 'org_id,email_address', ignoreDuplicates: true },
        );
      }
    } catch {
      // Suppression is a defensive secondary effect -- never fails the webhook over it.
    }
  }

  return { alreadyProcessed: false, eventType: event.type };
}
