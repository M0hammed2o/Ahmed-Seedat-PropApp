import { describe, expect, it } from 'vitest';
import {
  buildTenantAccountInvitationVariables,
  buildPaymentReceivedConfirmationVariables,
  buildPaymentConfirmationRequiredVariables,
  buildRentPaymentReminderVariables,
  buildRentOverdueNoticeVariables,
  buildMaintenanceRequestUpdateVariables,
  buildLeaseExpiryReminderVariables,
  buildOwnerMonthlyPropertySummaryVariables,
  buildApplicationInvitationVariables,
  buildApplicationDocumentsRequestedVariables,
  buildApplicationApprovedVariables,
  buildApplicationDeclinedVariables,
  buildLeaseReadyVariables,
} from '../whatsappTemplateVariables';
import { WHATSAPP_TEMPLATE_REGISTRY, isKnownWhatsAppTemplate } from '../whatsappTemplates';

// Final Meta template reconciliation, 2026-08-17: Mohammed exported and reviewed the real
// ACTIVE/APPROVED body text for all 8 templates from Meta WhatsApp Manager. Because
// MetaWhatsAppProvider.sendTemplateMessage converts Object.values(variables) into positional
// {{1}}, {{2}}, ... (JS object-key insertion order), the ONLY thing that determines what a real
// customer actually sees is each builder's own return-literal key order below. These tests fail
// if a variable is missing, added, or reordered -- exactly the property that matters here -- by
// asserting Object.keys() against the documented order verbatim, not just checking values exist.

describe('WhatsApp template variable builders -- exact order matches the real approved Meta structure', () => {
  it('tenant_account_invitation: organizationName, acceptUrl, supportName (3)', () => {
    const result = buildTenantAccountInvitationVariables({
      organizationName: 'Org',
      acceptUrl: 'https://x/activate',
      supportName: 'Support',
    });
    expect(Object.keys(result)).toEqual(['organizationName', 'acceptUrl', 'supportName']);
    expect(Object.values(result)).toEqual(['Org', 'https://x/activate', 'Support']);
  });

  it('payment_received_confirmation: amount, propertyLabel, paymentPeriod, dateConfirmed, accountLink (5)', () => {
    const result = buildPaymentReceivedConfirmationVariables({
      amount: 'R8,500.00',
      propertyLabel: 'Unit 4, Example Apartments',
      paymentPeriod: 'August 2026',
      dateConfirmed: '16 August 2026',
      accountLink: 'https://proplyst.co.za/tenant/payments',
    });
    expect(Object.keys(result)).toEqual([
      'amount',
      'propertyLabel',
      'paymentPeriod',
      'dateConfirmed',
      'accountLink',
    ]);
    // Real values from Mohammed's own rendered-preview example (2026-08-17), positional {{1}}..{{5}}.
    expect(Object.values(result)).toEqual([
      'R8,500.00',
      'Unit 4, Example Apartments',
      'August 2026',
      '16 August 2026',
      'https://proplyst.co.za/tenant/payments',
    ]);
  });

  it('payment_confirmation_required: amount, propertyLabel, tenantName, paymentMethod, paymentPeriod, reviewLink (6)', () => {
    const result = buildPaymentConfirmationRequiredVariables({
      amount: '5000',
      propertyLabel: 'Property A',
      tenantName: 'Jane Tenant',
      paymentMethod: 'eft',
      paymentPeriod: 'March 2026',
      reviewLink: 'https://x/owner-portal/payments',
    });
    expect(Object.keys(result)).toEqual([
      'amount',
      'propertyLabel',
      'tenantName',
      'paymentMethod',
      'paymentPeriod',
      'reviewLink',
    ]);
  });

  it('rent_payment_reminder: amount, paymentPeriod, dueDate, propertyLabel, accountLink (5) -- corrected structure', () => {
    const result = buildRentPaymentReminderVariables({
      amount: '5000',
      paymentPeriod: 'August 2026',
      dueDate: '01 August 2026',
      propertyLabel: 'Property A',
      accountLink: 'https://x/my-payments',
    });
    expect(Object.keys(result)).toEqual([
      'amount',
      'paymentPeriod',
      'dueDate',
      'propertyLabel',
      'accountLink',
    ]);
    // Guards against silently reverting to the old, wrong 3-var guess.
    expect(Object.keys(result)).not.toContain('organizationName');
  });

  it('rent_overdue_notice: outstandingAmount, tenantName, propertyLabel, paymentPeriod, accountLink (5)', () => {
    const result = buildRentOverdueNoticeVariables({
      outstandingAmount: '5000',
      tenantName: 'Jane Tenant',
      propertyLabel: 'Property A',
      paymentPeriod: 'August 2026',
      accountLink: 'https://x/my-payments',
    });
    expect(Object.keys(result)).toEqual([
      'outstandingAmount',
      'tenantName',
      'propertyLabel',
      'paymentPeriod',
      'accountLink',
    ]);
  });

  it('maintenance_request_update: propertyLabel, summary, status, updateMessage, ticketLink (5)', () => {
    const result = buildMaintenanceRequestUpdateVariables({
      propertyLabel: 'Property A — Unit 1',
      summary: 'Leaking tap',
      status: 'in_progress',
      updateMessage: 'A plumber has been scheduled.',
      ticketLink: 'https://x/my-maintenance',
    });
    expect(Object.keys(result)).toEqual([
      'propertyLabel',
      'summary',
      'status',
      'updateMessage',
      'ticketLink',
    ]);
  });

  it('lease_expiry_reminder: tenantName, propertyLabel, expiryDate, leaseLink (4)', () => {
    const result = buildLeaseExpiryReminderVariables({
      tenantName: 'Jane Tenant',
      propertyLabel: 'Property A',
      expiryDate: '2026-09-30',
      leaseLink: 'https://x/my-lease',
    });
    expect(Object.keys(result)).toEqual(['tenantName', 'propertyLabel', 'expiryDate', 'leaseLink']);
  });

  it('owner_monthly_property_summary: month, propertyCount, expectedRent, confirmedPaid, outstanding, awaitingConfirmation, openMaintenance, upcomingLeaseExpiries, reportUrl (9), no organizationName', () => {
    const result = buildOwnerMonthlyPropertySummaryVariables({
      month: 'March 2026',
      propertyCount: '2',
      expectedRent: '10000.00',
      confirmedPaid: '8000.00',
      outstanding: '2000.00',
      awaitingConfirmation: '500.00',
      openMaintenance: '1',
      upcomingLeaseExpiries: '0',
      reportUrl: 'https://x/owner-portal/summary/abc',
    });
    expect(Object.keys(result)).toEqual([
      'month',
      'propertyCount',
      'expectedRent',
      'confirmedPaid',
      'outstanding',
      'awaitingConfirmation',
      'openMaintenance',
      'upcomingLeaseExpiries',
      'reportUrl',
    ]);
    expect(Object.keys(result)).not.toContain('organizationName');
  });
});

// WhatsApp launch-completion pass, variable-structure reconciliation (WORKLOG.md 2026-08-27):
// Mohammed supplied the real approved Meta template documents for all 13 templates.
// application_invitation and application_documents_requested were already correct
// (organizationName, propertyLabel, url). application_approved/application_declined/lease_ready
// were NOT -- their real approved bodies lead with the property/unit label, then the organisation
// name, the reverse of what these builders returned before this pass. Fixed in
// whatsappTemplateVariables.ts; these assertions now match the real Meta body text exactly, not
// just this codebase's own internal consistency -- variableCountVerified is true in the registry
// as of this pass on that basis.
describe('applicant/lease WhatsApp template variable builders -- verified against the real approved Meta template text', () => {
  it('application_invitation: organizationName, propertyLabel, applyUrl (3) -- "invited by {{1}} to apply for {{2}}... {{3}}"', () => {
    const result = buildApplicationInvitationVariables({
      organizationName: 'Acme Rentals',
      propertyLabel: 'Property A — Unit 1',
      applyUrl: 'https://x/apply/token',
    });
    expect(Object.keys(result)).toEqual(['organizationName', 'propertyLabel', 'applyUrl']);
  });

  it('application_documents_requested: organizationName, propertyLabel, applyUrl (3) -- "with {{1}} at {{2}}... {{3}}"', () => {
    const result = buildApplicationDocumentsRequestedVariables({
      organizationName: 'Acme Rentals',
      propertyLabel: 'Property A — Unit 1',
      applyUrl: 'https://x/apply/token',
    });
    expect(Object.keys(result)).toEqual(['organizationName', 'propertyLabel', 'applyUrl']);
  });

  it('application_approved: propertyLabel, organizationName (2) -- "application for {{1}} has been approved by {{2}}"', () => {
    const result = buildApplicationApprovedVariables({
      propertyLabel: 'Property A — Unit 1',
      organizationName: 'Acme Rentals',
    });
    expect(Object.keys(result)).toEqual(['propertyLabel', 'organizationName']);
  });

  it('application_declined: propertyLabel, organizationName (2) -- "application for {{1}} through {{2}}"', () => {
    const result = buildApplicationDeclinedVariables({
      propertyLabel: 'Property A — Unit 1',
      organizationName: 'Acme Rentals',
    });
    expect(Object.keys(result)).toEqual(['propertyLabel', 'organizationName']);
  });

  it('lease_ready: propertyLabel, organizationName, leaseUrl (3) -- "lease for {{1}} is ready for review from {{2}}... {{3}}"', () => {
    const result = buildLeaseReadyVariables({
      propertyLabel: 'Property A — Unit 1',
      organizationName: 'Acme Rentals',
      leaseUrl: 'https://x/my-lease',
    });
    expect(Object.keys(result)).toEqual(['propertyLabel', 'organizationName', 'leaseUrl']);
  });
});

describe("builder output count matches the registry's own expectedVariableCount, for every template", () => {
  it.each([
    [
      'tenant_account_invitation',
      buildTenantAccountInvitationVariables({
        organizationName: 'a',
        acceptUrl: 'b',
        supportName: 'c',
      }),
    ],
    [
      'payment_received_confirmation',
      buildPaymentReceivedConfirmationVariables({
        amount: 'a',
        propertyLabel: 'b',
        paymentPeriod: 'c',
        dateConfirmed: 'd',
        accountLink: 'e',
      }),
    ],
    [
      'payment_confirmation_required',
      buildPaymentConfirmationRequiredVariables({
        amount: 'a',
        propertyLabel: 'b',
        tenantName: 'c',
        paymentMethod: 'd',
        paymentPeriod: 'e',
        reviewLink: 'f',
      }),
    ],
    [
      'rent_payment_reminder',
      buildRentPaymentReminderVariables({
        amount: 'a',
        paymentPeriod: 'b',
        dueDate: 'c',
        propertyLabel: 'd',
        accountLink: 'e',
      }),
    ],
    [
      'rent_overdue_notice',
      buildRentOverdueNoticeVariables({
        outstandingAmount: 'a',
        tenantName: 'b',
        propertyLabel: 'c',
        paymentPeriod: 'd',
        accountLink: 'e',
      }),
    ],
    [
      'maintenance_request_update',
      buildMaintenanceRequestUpdateVariables({
        propertyLabel: 'a',
        summary: 'b',
        status: 'c',
        updateMessage: 'd',
        ticketLink: 'e',
      }),
    ],
    [
      'lease_expiry_reminder',
      buildLeaseExpiryReminderVariables({
        tenantName: 'a',
        propertyLabel: 'b',
        expiryDate: 'c',
        leaseLink: 'd',
      }),
    ],
    [
      'owner_monthly_property_summary',
      buildOwnerMonthlyPropertySummaryVariables({
        month: 'a',
        propertyCount: 'b',
        expectedRent: 'c',
        confirmedPaid: 'd',
        outstanding: 'e',
        awaitingConfirmation: 'f',
        openMaintenance: 'g',
        upcomingLeaseExpiries: 'h',
        reportUrl: 'i',
      }),
    ],
    [
      'application_invitation',
      buildApplicationInvitationVariables({ organizationName: 'a', propertyLabel: 'b', applyUrl: 'c' }),
    ],
    [
      'application_documents_requested',
      buildApplicationDocumentsRequestedVariables({ organizationName: 'a', propertyLabel: 'b', applyUrl: 'c' }),
    ],
    [
      'application_approved',
      buildApplicationApprovedVariables({ organizationName: 'a', propertyLabel: 'b' }),
    ],
    [
      'application_declined',
      buildApplicationDeclinedVariables({ organizationName: 'a', propertyLabel: 'b' }),
    ],
    [
      'lease_ready',
      buildLeaseReadyVariables({ organizationName: 'a', propertyLabel: 'b', leaseUrl: 'c' }),
    ],
  ] as [string, Record<string, string>][])(
    '%s builder output length matches WHATSAPP_TEMPLATE_REGISTRY.expectedVariableCount',
    (name, built) => {
      const def = WHATSAPP_TEMPLATE_REGISTRY[name as keyof typeof WHATSAPP_TEMPLATE_REGISTRY];
      expect(Object.keys(built)).toHaveLength(def.expectedVariableCount);
    },
  );
});

describe('deleted/legacy WhatsApp template names can never be dispatched', () => {
  it('rejects every known-deleted or renamed-away alias', () => {
    const legacyAliases = [
      'tenant_invitation', // renamed to tenant_account_invitation
      'payment_accepted', // renamed to payment_received_confirmation
      'maintenance_update_critical', // renamed to maintenance_request_update
      'payment_awaiting_confirmation', // renamed to payment_confirmation_required
      'rent_overdue_material', // renamed to rent_overdue_notice
      'lease_expiring_soon', // renamed to lease_expiry_reminder
    ];
    for (const name of legacyAliases) {
      expect(isKnownWhatsAppTemplate(name), `${name} must not be dispatchable`).toBe(false);
    }
  });

  it('owner_statement_available (a real WhatsAppNotificationType with a call site, but not one of the 8 named Meta templates) is not in the registry', () => {
    expect(isKnownWhatsAppTemplate('owner_statement_available')).toBe(false);
  });
});
