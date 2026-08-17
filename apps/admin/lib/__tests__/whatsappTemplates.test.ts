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

describe('WHATSAPP_TEMPLATE_REGISTRY', () => {
  it("every registered template is approved, per Mohammed's direct 2026-08-17 confirmation", () => {
    for (const [name, def] of Object.entries(WHATSAPP_TEMPLATE_REGISTRY)) {
      expect(def.approved, `${name} should be approved`).toBe(true);
    }
  });

  it('every one of the 8 templates has a positive expectedVariableCount and is variableCountVerified, per the real Meta export Mohammed reviewed 2026-08-17', () => {
    for (const [name, def] of Object.entries(WHATSAPP_TEMPLATE_REGISTRY)) {
      expect(
        def.expectedVariableCount,
        `${name} should have a positive variable count`,
      ).toBeGreaterThan(0);
      expect(def.variableCountVerified, `${name} should be variableCountVerified`).toBe(true);
    }
  });

  it("every registered template's metaTemplateName matches its own registry key", () => {
    for (const [name, def] of Object.entries(WHATSAPP_TEMPLATE_REGISTRY)) {
      expect(def.metaTemplateName).toBe(name);
    }
  });

  it('registers exactly the 8 Meta templates, all now with a real dispatch call site', () => {
    expect(Object.keys(WHATSAPP_TEMPLATE_REGISTRY).sort()).toEqual(
      [
        'maintenance_request_update',
        'payment_received_confirmation',
        'tenant_account_invitation',
        'payment_confirmation_required',
        'rent_payment_reminder',
        'rent_overdue_notice',
        'lease_expiry_reminder',
        'owner_monthly_property_summary',
      ].sort(),
    );
  });
});

describe('isKnownWhatsAppTemplate', () => {
  it('recognizes a registered template name', () => {
    expect(isKnownWhatsAppTemplate('tenant_account_invitation')).toBe(true);
  });

  it('rejects an unregistered template name, including a deleted old one', () => {
    expect(isKnownWhatsAppTemplate('tenant_invitation')).toBe(false);
    expect(isKnownWhatsAppTemplate('owner_statement_available')).toBe(false);
    expect(isKnownWhatsAppTemplate('anything_made_up')).toBe(false);
  });
});

describe('isWhatsAppTemplateApproved', () => {
  it('returns true for every one of the 8 real templates, per direct confirmation 2026-08-17', () => {
    expect(isWhatsAppTemplateApproved('tenant_account_invitation')).toBe(true);
    expect(isWhatsAppTemplateApproved('payment_received_confirmation')).toBe(true);
    expect(isWhatsAppTemplateApproved('maintenance_request_update')).toBe(true);
    expect(isWhatsAppTemplateApproved('payment_confirmation_required')).toBe(true);
    expect(isWhatsAppTemplateApproved('rent_payment_reminder')).toBe(true);
    expect(isWhatsAppTemplateApproved('rent_overdue_notice')).toBe(true);
    expect(isWhatsAppTemplateApproved('lease_expiry_reminder')).toBe(true);
    expect(isWhatsAppTemplateApproved('owner_monthly_property_summary')).toBe(true);
  });

  it('fails safe (false), not open (true), for an unrecognized template name', () => {
    expect(isWhatsAppTemplateApproved('not_a_real_template')).toBe(false);
  });
});
