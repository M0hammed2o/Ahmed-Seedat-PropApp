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
// First-tenant-workflow predeploy pass (WORKLOG.md 2026-08-25), Phase 6/21: 5 new applicant/lease
// templates were added to the registry, all correctly `approved: false, variableCountVerified:
// false` (none have been created/submitted in Meta Business Manager yet) -- the registry is no
// longer "exactly 8, all approved," it's "8 real + verified, plus 5 proposed + unapproved." Split
// below so each group's own invariant stays independently testable.

const APPROVED_PRODUCTION_TEMPLATES = [
  'maintenance_request_update',
  'payment_received_confirmation',
  'tenant_account_invitation',
  'payment_confirmation_required',
  'rent_payment_reminder',
  'rent_overdue_notice',
  'lease_expiry_reminder',
  'owner_monthly_property_summary',
] as const;

const PROPOSED_UNAPPROVED_TEMPLATES = [
  'application_invitation',
  'application_documents_requested',
  'application_approved',
  'application_declined',
  'lease_ready',
] as const;

describe('WHATSAPP_TEMPLATE_REGISTRY', () => {
  it("every one of the 8 real templates is approved, per Mohammed's direct 2026-08-17 confirmation", () => {
    for (const name of APPROVED_PRODUCTION_TEMPLATES) {
      expect(WHATSAPP_TEMPLATE_REGISTRY[name].approved, `${name} should be approved`).toBe(true);
    }
  });

  it('every one of the 5 proposed applicant/lease templates is NOT approved -- none has been submitted to Meta yet', () => {
    for (const name of PROPOSED_UNAPPROVED_TEMPLATES) {
      expect(WHATSAPP_TEMPLATE_REGISTRY[name].approved, `${name} should not be approved`).toBe(
        false,
      );
    }
  });

  it('every one of the 8 real templates has a positive expectedVariableCount and is variableCountVerified, per the real Meta export Mohammed reviewed 2026-08-17', () => {
    for (const name of APPROVED_PRODUCTION_TEMPLATES) {
      const def = WHATSAPP_TEMPLATE_REGISTRY[name];
      expect(
        def.expectedVariableCount,
        `${name} should have a positive variable count`,
      ).toBeGreaterThan(0);
      expect(def.variableCountVerified, `${name} should be variableCountVerified`).toBe(true);
    }
  });

  it('every one of the 5 proposed templates has a positive expectedVariableCount but is NOT variableCountVerified (proposed counts, never confirmed against a real Meta export)', () => {
    for (const name of PROPOSED_UNAPPROVED_TEMPLATES) {
      const def = WHATSAPP_TEMPLATE_REGISTRY[name];
      expect(
        def.expectedVariableCount,
        `${name} should have a positive variable count`,
      ).toBeGreaterThan(0);
      expect(def.variableCountVerified, `${name} should not be variableCountVerified`).toBe(
        false,
      );
    }
  });

  it("every registered template's metaTemplateName matches its own registry key", () => {
    for (const [name, def] of Object.entries(WHATSAPP_TEMPLATE_REGISTRY)) {
      expect(def.metaTemplateName).toBe(name);
    }
  });

  it('registers exactly the 8 real production templates plus the 5 proposed applicant/lease templates', () => {
    expect(Object.keys(WHATSAPP_TEMPLATE_REGISTRY).sort()).toEqual(
      [...APPROVED_PRODUCTION_TEMPLATES, ...PROPOSED_UNAPPROVED_TEMPLATES].sort(),
    );
  });
});

describe('isKnownWhatsAppTemplate', () => {
  it('recognizes a registered template name', () => {
    expect(isKnownWhatsAppTemplate('tenant_account_invitation')).toBe(true);
  });

  it('recognizes a proposed (not yet approved) template name too -- known and approved are separate questions', () => {
    expect(isKnownWhatsAppTemplate('application_invitation')).toBe(true);
  });

  it('rejects an unregistered template name, including a deleted old one', () => {
    expect(isKnownWhatsAppTemplate('tenant_invitation')).toBe(false);
    expect(isKnownWhatsAppTemplate('owner_statement_available')).toBe(false);
    expect(isKnownWhatsAppTemplate('anything_made_up')).toBe(false);
  });
});

describe('isWhatsAppTemplateApproved', () => {
  it('returns true for every one of the 8 real templates, per direct confirmation 2026-08-17', () => {
    for (const name of APPROVED_PRODUCTION_TEMPLATES) {
      expect(isWhatsAppTemplateApproved(name)).toBe(true);
    }
  });

  it('returns false for every one of the 5 proposed applicant/lease templates -- known but not approved', () => {
    for (const name of PROPOSED_UNAPPROVED_TEMPLATES) {
      expect(isWhatsAppTemplateApproved(name)).toBe(false);
    }
  });

  it('fails safe (false), not open (true), for an unrecognized template name', () => {
    expect(isWhatsAppTemplateApproved('not_a_real_template')).toBe(false);
  });
});
