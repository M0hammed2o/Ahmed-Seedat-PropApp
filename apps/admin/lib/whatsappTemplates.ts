import 'server-only';
import type { WhatsAppNotificationType } from '@propvault/types';

/**
 * WhatsApp V1 completion pass, Phase K (WORKLOG.md this date). Single source of truth for which
 * Meta templates this codebase is allowed to actually send against, and how many positional body
 * variables each expects. Closes a real, freshly-urgent gap: Render now carries real
 * WHATSAPP_ACCESS_TOKEN/PHONE_NUMBER_ID/WEBHOOK_SECRET (the previous pass's own production setup),
 * so `getWhatsAppProvider()` already returns the real `MetaWhatsAppProvider` in production --
 * every currently-wired trigger (tenant_account_invitation, payment_received_confirmation,
 * maintenance_request_update) would attempt a REAL Meta API call the moment it fires, against
 * templates Meta has not yet approved. Meta itself rejects an unapproved-template send (so no
 * malformed message can ever actually reach a recipient), but that's an accident of Meta's own
 * API behaviour, not something this codebase should rely on -- `dispatchWhatsApp()` now checks
 * `approved` here BEFORE ever calling the provider, so an unapproved template fails fast, locally,
 * observably (`reason: 'template_not_approved'`), without spending a real API call or depending on
 * Meta's rejection being the only thing standing between "in review" and a customer's phone.
 *
 * Every value below is `approved: false` until Mohammed explicitly confirms a template shows
 * Active/Approved in Meta Business Manager -- flipping one boolean is the entire "go live" action
 * for that specific event; no other code changes are required.
 */
export interface WhatsAppTemplateDefinition {
  /** Must match the exact template name in Meta Business Manager -- `sendTemplateMessage()` sends
   * this as `template.name` verbatim (MetaWhatsAppProvider). */
  metaTemplateName: WhatsAppNotificationType;
  /** Flip to true only once Mohammed confirms this exact template's Meta status is
   * Active/Approved. Never inferred, never defaulted true. */
  approved: boolean;
  /** Positional body variable count this codebase's call site currently sends. Recorded here (not
   * just implicitly at each call site) so a call site can be tested against it and a future
   * mismatch is a visible, single-source-of-truth diff, not a silent drift. UNVERIFIED where noted
   * -- carried over from the old, deleted template's structure, never confirmed against what Meta
   * actually approved for the new one. */
  expectedVariableCount: number;
  variableCountVerified: boolean;
}

export const WHATSAPP_TEMPLATE_REGISTRY: Record<
  Extract<
    WhatsAppNotificationType,
    | 'tenant_account_invitation'
    | 'payment_received_confirmation'
    | 'maintenance_request_update'
    | 'payment_confirmation_required'
    | 'rent_payment_reminder'
    | 'rent_overdue_notice'
    | 'lease_expiry_reminder'
  >,
  WhatsAppTemplateDefinition
> = {
  tenant_account_invitation: {
    metaTemplateName: 'tenant_account_invitation',
    approved: false,
    expectedVariableCount: 4, // organizationName, acceptUrl, code, supportName -- UNVERIFIED
    variableCountVerified: false,
  },
  payment_received_confirmation: {
    metaTemplateName: 'payment_received_confirmation',
    approved: false,
    expectedVariableCount: 1, // amount -- UNVERIFIED
    variableCountVerified: false,
  },
  maintenance_request_update: {
    metaTemplateName: 'maintenance_request_update',
    approved: false,
    expectedVariableCount: 4, // organizationName, summary, status, supportName -- UNVERIFIED
    variableCountVerified: false,
  },
  payment_confirmation_required: {
    metaTemplateName: 'payment_confirmation_required',
    approved: false,
    expectedVariableCount: 2, // organizationName, amount -- UNVERIFIED, this pass's own new call site
    variableCountVerified: false,
  },
  rent_payment_reminder: {
    metaTemplateName: 'rent_payment_reminder',
    approved: false,
    expectedVariableCount: 3, // organizationName, amount, dueDate -- UNVERIFIED, this pass's own new call site
    variableCountVerified: false,
  },
  rent_overdue_notice: {
    metaTemplateName: 'rent_overdue_notice',
    approved: false,
    expectedVariableCount: 3, // organizationName, amount, dueDate -- UNVERIFIED, this pass's own new call site
    variableCountVerified: false,
  },
  lease_expiry_reminder: {
    metaTemplateName: 'lease_expiry_reminder',
    approved: false,
    expectedVariableCount: 2, // organizationName, endDate -- UNVERIFIED, this pass's own new call site
    variableCountVerified: false,
  },
};

export type RegisteredWhatsAppTemplateName = keyof typeof WHATSAPP_TEMPLATE_REGISTRY;

export function isKnownWhatsAppTemplate(name: string): name is RegisteredWhatsAppTemplateName {
  return Object.prototype.hasOwnProperty.call(WHATSAPP_TEMPLATE_REGISTRY, name);
}

/** True only for a template this codebase both knows about AND has been explicitly confirmed
 * Active/Approved. A template with a real dispatch call site but no registry entry (should never
 * happen -- every DispatchableWhatsAppType is required to have one, enforced by
 * whatsappDispatch.test.ts) is treated as unapproved, fail-safe, not fail-open. */
export function isWhatsAppTemplateApproved(name: string): boolean {
  return isKnownWhatsAppTemplate(name) && WHATSAPP_TEMPLATE_REGISTRY[name].approved;
}
