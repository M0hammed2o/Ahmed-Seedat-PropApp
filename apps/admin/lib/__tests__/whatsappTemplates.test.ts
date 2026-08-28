import { describe, expect, it } from 'vitest';
import {
  WHATSAPP_TEMPLATE_REGISTRY,
  isKnownWhatsAppTemplate,
  isWhatsAppTemplateApproved,
} from '../whatsappTemplates';

// WhatsApp V1 completion pass, Phase K (WORKLOG.md this date). Pure unit tests -- no DB, no
// provider -- for the template-approval gate `dispatchWhatsApp()` now checks before ever calling
// a real provider. Originally asserted every value defaults to unapproved; updated 2026-08-17
// (final pre-production pass) once Mohammed directly confirmed, in conversation, that all 8
// templates show Active/Approved in Meta -- the property worth testing now is that `approved`
// reflects that real, explicit confirmation (never silently defaults true on its own), and that
// an unrecognized name still fails safe regardless.
//
// WhatsApp launch-completion pass (WORKLOG.md 2026-08-27, two updates same day):
// (1) Mohammed confirmed in Meta WhatsApp Manager that the 5 applicant/lease templates are now
//     ALSO Active/Approved -- all 13 registered templates are approved now.
// (2) Mohammed then supplied the real approved Meta template documents for all 13 (the exact body
//     text, variable samples, and category for each). Every template's expectedVariableCount/order
//     was reconciled against that document -- all 13 are now variableCountVerified: true, on equal
//     footing. (Reconciliation found and fixed a real order bug in 3 of the 5 applicant/lease
//     builders -- see whatsappTemplateVariables.ts's own comments.)

const ALL_TEMPLATES = [
  'maintenance_request_update',
  'payment_received_confirmation',
  'tenant_account_invitation',
  'payment_confirmation_required',
  'rent_payment_reminder',
  'rent_overdue_notice',
  'lease_expiry_reminder',
  'owner_monthly_property_summary',
  'application_invitation',
  'application_documents_requested',
  'application_approved',
  'application_declined',
  'lease_ready',
] as const;

const UTILITY_TEMPLATES = [
  'maintenance_request_update',
  'payment_received_confirmation',
  'tenant_account_invitation',
  'payment_confirmation_required',
  'rent_payment_reminder',
  'rent_overdue_notice',
  'lease_expiry_reminder',
  'owner_monthly_property_summary',
  'application_documents_requested',
  'application_approved',
  'application_declined',
  'lease_ready',
] as const;

describe('WHATSAPP_TEMPLATE_REGISTRY', () => {
  it('every one of the 13 registered templates is approved, per direct confirmation (8: 2026-08-17, 5 applicant/lease: 2026-08-27)', () => {
    for (const name of ALL_TEMPLATES) {
      expect(WHATSAPP_TEMPLATE_REGISTRY[name].approved, `${name} should be approved`).toBe(true);
    }
  });

  it('every one of the 13 registered templates has a positive expectedVariableCount and is variableCountVerified, per the real Meta template document Mohammed supplied', () => {
    for (const name of ALL_TEMPLATES) {
      const def = WHATSAPP_TEMPLATE_REGISTRY[name];
      expect(
        def.expectedVariableCount,
        `${name} should have a positive variable count`,
      ).toBeGreaterThan(0);
      expect(def.variableCountVerified, `${name} should be variableCountVerified`).toBe(true);
    }
  });

  it('application_invitation is classified Marketing in Meta -- confirmed, not an error, and not a reason to rename/replace the template', () => {
    expect(WHATSAPP_TEMPLATE_REGISTRY.application_invitation.metaCategory).toBe('marketing');
  });

  it('every other registered template is classified Utility in Meta', () => {
    for (const name of UTILITY_TEMPLATES) {
      expect(
        WHATSAPP_TEMPLATE_REGISTRY[name].metaCategory,
        `${name} should be classified utility`,
      ).toBe('utility');
    }
  });

  it("every registered template's metaTemplateName matches its own registry key", () => {
    for (const [name, def] of Object.entries(WHATSAPP_TEMPLATE_REGISTRY)) {
      expect(def.metaTemplateName).toBe(name);
    }
  });

  it('registers exactly these 13 templates -- no more, no fewer', () => {
    expect(Object.keys(WHATSAPP_TEMPLATE_REGISTRY).sort()).toEqual([...ALL_TEMPLATES].sort());
  });
});

describe('isKnownWhatsAppTemplate', () => {
  it('recognizes a registered template name', () => {
    expect(isKnownWhatsAppTemplate('tenant_account_invitation')).toBe(true);
  });

  it('recognizes an applicant/lease template name too', () => {
    expect(isKnownWhatsAppTemplate('application_invitation')).toBe(true);
  });

  it('rejects an unregistered template name, including a deleted old one', () => {
    expect(isKnownWhatsAppTemplate('tenant_invitation')).toBe(false);
    expect(isKnownWhatsAppTemplate('owner_statement_available')).toBe(false);
    expect(isKnownWhatsAppTemplate('anything_made_up')).toBe(false);
  });
});

describe('isWhatsAppTemplateApproved', () => {
  it('returns true for every one of the 13 registered templates', () => {
    for (const name of ALL_TEMPLATES) {
      expect(isWhatsAppTemplateApproved(name)).toBe(true);
    }
  });

  it('fails safe (false), not open (true), for an unrecognized template name', () => {
    expect(isWhatsAppTemplateApproved('not_a_real_template')).toBe(false);
  });
});
