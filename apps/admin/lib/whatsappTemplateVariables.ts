import 'server-only';

// Final Meta template reconciliation (WORKLOG.md 2026-08-17): Mohammed exported and reviewed all
// 8 real ACTIVE/APPROVED templates from Meta WhatsApp Manager and gave their exact body text and
// positional variable order. MetaWhatsAppProvider.sendTemplateMessage converts
// `Object.values(input.variables)` into {{1}}, {{2}}, ... in JS object-key insertion order -- so
// the ONE thing that actually determines what a real customer sees is each of these builders'
// own return-literal key order, not whatever order a caller happens to assemble its input in.
// Every dispatch call site builds its `variables` object through the matching function below
// instead of an inline object literal, specifically so a reorder/addition/removal is a one-line,
// directly unit-testable diff in exactly one place per template
// (whatsappTemplateStructure.test.ts), not a fact buried inside a route handler.

export function buildTenantAccountInvitationVariables(input: {
  organizationName: string;
  acceptUrl: string;
  supportName: string;
}): Record<string, string> {
  return {
    organizationName: input.organizationName,
    acceptUrl: input.acceptUrl,
    supportName: input.supportName,
  };
}

export function buildPaymentReceivedConfirmationVariables(input: {
  amount: string;
  propertyLabel: string;
  paymentPeriod: string;
  dateConfirmed: string;
  accountLink: string;
}): Record<string, string> {
  return {
    amount: input.amount,
    propertyLabel: input.propertyLabel,
    paymentPeriod: input.paymentPeriod,
    dateConfirmed: input.dateConfirmed,
    accountLink: input.accountLink,
  };
}

export function buildPaymentConfirmationRequiredVariables(input: {
  amount: string;
  propertyLabel: string;
  tenantName: string;
  paymentMethod: string;
  paymentPeriod: string;
  reviewLink: string;
}): Record<string, string> {
  return {
    amount: input.amount,
    propertyLabel: input.propertyLabel,
    tenantName: input.tenantName,
    paymentMethod: input.paymentMethod,
    paymentPeriod: input.paymentPeriod,
    reviewLink: input.reviewLink,
  };
}

/**
 * Corrected 2026-08-17: the previously-unverified 3-var guess (organizationName, amount, dueDate)
 * was wrong. The real approved body has 5 placeholders: "{{1}} is due for {{2}} on {{3}}"
 * (amount, payment period, due date), then property, then a link -- payment PERIOD and due DATE
 * are two distinct real variables here (unlike rent_overdue_notice, which only has period).
 */
export function buildRentPaymentReminderVariables(input: {
  amount: string;
  paymentPeriod: string;
  dueDate: string;
  propertyLabel: string;
  accountLink: string;
}): Record<string, string> {
  return {
    amount: input.amount,
    paymentPeriod: input.paymentPeriod,
    dueDate: input.dueDate,
    propertyLabel: input.propertyLabel,
    accountLink: input.accountLink,
  };
}

export function buildRentOverdueNoticeVariables(input: {
  outstandingAmount: string;
  tenantName: string;
  propertyLabel: string;
  paymentPeriod: string;
  accountLink: string;
}): Record<string, string> {
  return {
    outstandingAmount: input.outstandingAmount,
    tenantName: input.tenantName,
    propertyLabel: input.propertyLabel,
    paymentPeriod: input.paymentPeriod,
    accountLink: input.accountLink,
  };
}

export function buildMaintenanceRequestUpdateVariables(input: {
  propertyLabel: string;
  summary: string;
  status: string;
  updateMessage: string;
  ticketLink: string;
}): Record<string, string> {
  return {
    propertyLabel: input.propertyLabel,
    summary: input.summary,
    status: input.status,
    updateMessage: input.updateMessage,
    ticketLink: input.ticketLink,
  };
}

export function buildLeaseExpiryReminderVariables(input: {
  tenantName: string;
  propertyLabel: string;
  expiryDate: string;
  leaseLink: string;
}): Record<string, string> {
  return {
    tenantName: input.tenantName,
    propertyLabel: input.propertyLabel,
    expiryDate: input.expiryDate,
    leaseLink: input.leaseLink,
  };
}

export function buildOwnerMonthlyPropertySummaryVariables(input: {
  month: string;
  propertyCount: string;
  expectedRent: string;
  confirmedPaid: string;
  outstanding: string;
  awaitingConfirmation: string;
  openMaintenance: string;
  upcomingLeaseExpiries: string;
  reportUrl: string;
}): Record<string, string> {
  return {
    month: input.month,
    propertyCount: input.propertyCount,
    expectedRent: input.expectedRent,
    confirmedPaid: input.confirmedPaid,
    outstanding: input.outstanding,
    awaitingConfirmation: input.awaitingConfirmation,
    openMaintenance: input.openMaintenance,
    upcomingLeaseExpiries: input.upcomingLeaseExpiries,
    reportUrl: input.reportUrl,
  };
}

// First-tenant-workflow predeploy pass (WORKLOG.md 2026-08-25), Phase 6/21: applicant/lease event
// variable builders, originally written against a proposed/unsubmitted structure.
//
// WhatsApp launch-completion pass, variable-structure reconciliation (WORKLOG.md 2026-08-27):
// Mohammed supplied the real approved Meta template documents (all 13, "Templates 1-13"). Reconciled
// every one of the 5 applicant/lease builders below against the real approved body text --
// application_invitation and application_documents_requested were already correct
// (organizationName, propertyLabel, [url]). application_approved, application_declined, and
// lease_ready were NOT: the real approved bodies all lead with the property/unit label, THEN the
// organisation name ("Your application for {{1}} [property] has been approved by {{2}} [org]"),
// the exact reverse of what these three builders returned. Object.values() insertion order is the
// only thing that determines what a real recipient actually sees (MetaWhatsAppProvider sends
// positionally) -- this was a real, would-have-shipped-wrong bug, not a style preference, caught
// before any real send. All 8 non-applicant templates were also re-checked against the same
// document and confirmed already correct (no changes).

export function buildApplicationInvitationVariables(input: {
  organizationName: string;
  propertyLabel: string;
  applyUrl: string;
}): Record<string, string> {
  return {
    organizationName: input.organizationName,
    propertyLabel: input.propertyLabel,
    applyUrl: input.applyUrl,
  };
}

export function buildApplicationDocumentsRequestedVariables(input: {
  organizationName: string;
  propertyLabel: string;
  applyUrl: string;
}): Record<string, string> {
  return {
    organizationName: input.organizationName,
    propertyLabel: input.propertyLabel,
    applyUrl: input.applyUrl,
  };
}

/** Real approved body: "Your application for {{1}} has been approved by {{2}}." -- property/unit
 * label FIRST, organisation name second (the reverse of application_invitation/
 * application_documents_requested's own order -- verified directly against Meta's template text,
 * not assumed consistent across templates). */
export function buildApplicationApprovedVariables(input: {
  propertyLabel: string;
  organizationName: string;
}): Record<string, string> {
  return { propertyLabel: input.propertyLabel, organizationName: input.organizationName };
}

/** Real approved body: "...application for {{1}} through {{2}}." -- property/unit label first,
 * organisation name second, same order as application_approved. */
export function buildApplicationDeclinedVariables(input: {
  propertyLabel: string;
  organizationName: string;
}): Record<string, string> {
  return { propertyLabel: input.propertyLabel, organizationName: input.organizationName };
}

/** Real approved body: "Your lease for {{1}} is ready for review from {{2}}." -- property/unit
 * label first, organisation name second, then the review URL. */
export function buildLeaseReadyVariables(input: {
  propertyLabel: string;
  organizationName: string;
  leaseUrl: string;
}): Record<string, string> {
  return {
    propertyLabel: input.propertyLabel,
    organizationName: input.organizationName,
    leaseUrl: input.leaseUrl,
  };
}
