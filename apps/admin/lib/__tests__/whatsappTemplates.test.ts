import { describe, expect, it } from 'vitest';
import {
  WHATSAPP_TEMPLATE_REGISTRY,
  isKnownWhatsAppTemplate,
  isWhatsAppTemplateApproved,
} from '../whatsappTemplates';

// WhatsApp V1 completion pass, Phase K (WORKLOG.md this date). Pure unit tests -- no DB, no
// provider -- for the template-approval gate `dispatchWhatsApp()` now checks before ever calling
// a real provider. The highest-value property here: every value defaults to unapproved, and stays
// that way until a human explicitly flips it -- never inferred, never accidentally true.

describe('WHATSAPP_TEMPLATE_REGISTRY', () => {
  it('every registered template defaults to unapproved -- nothing is approved by default', () => {
    for (const [name, def] of Object.entries(WHATSAPP_TEMPLATE_REGISTRY)) {
      expect(def.approved, `${name} should default to unapproved`).toBe(false);
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
  it('returns false for every template today (none confirmed approved yet)', () => {
    expect(isWhatsAppTemplateApproved('tenant_account_invitation')).toBe(false);
    expect(isWhatsAppTemplateApproved('payment_received_confirmation')).toBe(false);
    expect(isWhatsAppTemplateApproved('maintenance_request_update')).toBe(false);
    expect(isWhatsAppTemplateApproved('payment_confirmation_required')).toBe(false);
    expect(isWhatsAppTemplateApproved('rent_payment_reminder')).toBe(false);
    expect(isWhatsAppTemplateApproved('rent_overdue_notice')).toBe(false);
    expect(isWhatsAppTemplateApproved('lease_expiry_reminder')).toBe(false);
    expect(isWhatsAppTemplateApproved('owner_monthly_property_summary')).toBe(false);
  });

  it('fails safe (false), not open (true), for an unrecognized template name', () => {
    expect(isWhatsAppTemplateApproved('not_a_real_template')).toBe(false);
  });
});
