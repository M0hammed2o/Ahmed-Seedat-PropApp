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
 *
 * **2026-08-17 update (final pre-production pass)**: Mohammed directly confirmed, in conversation,
 * that all 8 templates now show Active/Approved in Meta Business Manager, and provided the real
 * approved parameter structure (count + semantic order) for 7 of the 8 -- every `approved` flag
 * below is now `true`.
 *
 * **Same-day follow-up**: Mohammed then exported and reviewed the actual approved body text for
 * ALL 8 templates directly from Meta WhatsApp Manager (the authoritative source, superseding the
 * earlier partial hand-off) -- including `rent_payment_reminder`, previously excluded and
 * unverified. Its real structure (amount, paymentPeriod, dueDate, propertyLabel, accountLink -- 5
 * vars, not the earlier 3-var organizationName/amount/dueDate guess) is now confirmed and its
 * call site corrected. **All 8 templates are now `variableCountVerified: true`.** Every call site
 * builds its `variables` object through a matching function in `lib/whatsappTemplateVariables.ts`
 * (never an inline object literal) specifically so the exact key order Meta requires
 * (`MetaWhatsAppProvider` sends `Object.values(input.variables)` positionally) is a single,
 * directly unit-tested source of truth per template, not a fact that could silently drift at one
 * call site while a test only checks another.
 */
export interface WhatsAppTemplateDefinition {
  /** Must match the exact template name in Meta Business Manager -- `sendTemplateMessage()` sends
   * this as `template.name` verbatim (MetaWhatsAppProvider). */
  metaTemplateName: WhatsAppNotificationType;
  /** Flip to true only once Mohammed confirms this exact template's Meta status is
   * Active/Approved. Never inferred, never defaulted true. */
  approved: boolean;
  /** Meta's own template category (Marketing/Utility/Authentication), as classified in Meta
   * Business Manager -- distinct from, and unrelated to, dispatchWhatsApp()'s internal
   * TEMPLATE_CATEGORY map (which groups templates for notification_preferences opt-out, a purely
   * in-app concept). Recorded here (WhatsApp launch-completion pass, WORKLOG.md 2026-08-27) purely
   * as tracked fact from Mohammed's real template export -- nothing in this codebase branches on
   * it. A template being Marketing rather than Utility is not an error and must never be "fixed"
   * by renaming/replacing the template. */
  metaCategory: 'marketing' | 'utility';
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
    | 'owner_monthly_property_summary'
    | 'application_invitation'
    | 'application_documents_requested'
    | 'application_approved'
    | 'application_declined'
    | 'lease_ready'
  >,
  WhatsAppTemplateDefinition
> = {
  tenant_account_invitation: {
    metaTemplateName: 'tenant_account_invitation',
    approved: true,
    metaCategory: 'utility',
    expectedVariableCount: 3, // organizationName, acceptUrl, supportName -- confirmed by Mohammed 2026-08-17, re-verified against the full Meta export 2026-08-27
    variableCountVerified: true,
  },
  payment_received_confirmation: {
    metaTemplateName: 'payment_received_confirmation',
    approved: true,
    metaCategory: 'utility',
    // amount, propertyLabel, paymentPeriod, dateConfirmed, accountLink -- confirmed by Mohammed
    // 2026-08-17, RE-confirmed the same day against the real Meta rendered-preview positional
    // mapping ({{1}}..{{5}}) after the Word/text export's own "Variable samples" section turned
    // out malformed/incomplete (4 rows shown for a 5-variable body) -- the export artifact was
    // wrong, not this structure. Re-verified again 2026-08-27 against the full Meta template
    // document (body text confirms this exact order).
    expectedVariableCount: 5,
    variableCountVerified: true,
  },
  maintenance_request_update: {
    metaTemplateName: 'maintenance_request_update',
    approved: true,
    metaCategory: 'utility',
    expectedVariableCount: 5, // propertyLabel, summary, status, updateMessage, ticketLink -- confirmed by Mohammed 2026-08-17, re-verified 2026-08-27
    variableCountVerified: true,
  },
  payment_confirmation_required: {
    metaTemplateName: 'payment_confirmation_required',
    approved: true,
    metaCategory: 'utility',
    expectedVariableCount: 6, // amount, propertyLabel, tenantName, paymentMethod, paymentPeriod, reviewLink -- confirmed by Mohammed 2026-08-17, re-verified 2026-08-27
    variableCountVerified: true,
  },
  rent_payment_reminder: {
    metaTemplateName: 'rent_payment_reminder',
    approved: true,
    metaCategory: 'utility',
    // amount, paymentPeriod, dueDate, propertyLabel, accountLink -- confirmed by Mohammed's real
    // Meta export, 2026-08-17. Corrects the earlier unverified 3-var guess (organizationName,
    // amount, dueDate), which was wrong. Re-verified 2026-08-27.
    expectedVariableCount: 5,
    variableCountVerified: true,
  },
  rent_overdue_notice: {
    metaTemplateName: 'rent_overdue_notice',
    approved: true,
    metaCategory: 'utility',
    expectedVariableCount: 5, // outstandingAmount, tenantName, propertyLabel, paymentPeriod, accountLink -- confirmed by Mohammed 2026-08-17, re-verified 2026-08-27
    variableCountVerified: true,
  },
  lease_expiry_reminder: {
    metaTemplateName: 'lease_expiry_reminder',
    approved: true,
    metaCategory: 'utility',
    expectedVariableCount: 4, // tenantName, propertyLabel, expiryDate, leaseLink -- confirmed by Mohammed 2026-08-17, re-verified 2026-08-27
    variableCountVerified: true,
  },
  owner_monthly_property_summary: {
    metaTemplateName: 'owner_monthly_property_summary',
    approved: true,
    metaCategory: 'utility',
    // month, propertyCount, expectedRent, confirmedPaid, outstanding, awaitingConfirmation,
    // openMaintenance, upcomingLeaseExpiries, reportUrl -- confirmed by Mohammed 2026-08-17.
    // NOTE: no organizationName variable -- the earlier draft prepended one that doesn't belong.
    // Re-verified 2026-08-27 against the full Meta template document.
    expectedVariableCount: 9,
    variableCountVerified: true,
  },
  // WhatsApp launch-completion pass, variable-structure reconciliation (WORKLOG.md 2026-08-27):
  // Mohammed supplied the real approved Meta template documents for all 5 of these (Templates
  // 9-13). Every builder in whatsappTemplateVariables.ts was checked against the real body text --
  // application_invitation and application_documents_requested were already correct;
  // application_approved, application_declined, and lease_ready had propertyLabel/organizationName
  // in the WRONG order (a real bug, fixed this pass, would have shipped a swapped property/org name
  // to every recipient of those three templates). variableCountVerified is true for all 5 now, on
  // the same footing as the original 8.
  application_invitation: {
    metaTemplateName: 'application_invitation',
    approved: true,
    metaCategory: 'marketing', // confirmed by Mohammed's real Meta export 2026-08-27 -- NOT an error, do not rename/replace the template over this
    expectedVariableCount: 3, // organizationName, propertyLabel, applyUrl -- confirmed against the real approved body 2026-08-27
    variableCountVerified: true,
  },
  application_documents_requested: {
    metaTemplateName: 'application_documents_requested',
    approved: true,
    metaCategory: 'utility',
    expectedVariableCount: 3, // organizationName, propertyLabel, applyUrl -- confirmed against the real approved body 2026-08-27
    variableCountVerified: true,
  },
  application_approved: {
    metaTemplateName: 'application_approved',
    approved: true,
    metaCategory: 'utility',
    expectedVariableCount: 2, // propertyLabel, organizationName (in that order -- corrected 2026-08-27, was previously reversed) -- confirmed against the real approved body
    variableCountVerified: true,
  },
  application_declined: {
    metaTemplateName: 'application_declined',
    approved: true,
    metaCategory: 'utility',
    expectedVariableCount: 2, // propertyLabel, organizationName (in that order -- corrected 2026-08-27, was previously reversed) -- confirmed against the real approved body
    variableCountVerified: true,
  },
  lease_ready: {
    metaTemplateName: 'lease_ready',
    approved: true,
    metaCategory: 'utility',
    expectedVariableCount: 3, // propertyLabel, organizationName, leaseUrl (in that order -- corrected 2026-08-27, was previously reversed) -- confirmed against the real approved body
    variableCountVerified: true,
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
