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
