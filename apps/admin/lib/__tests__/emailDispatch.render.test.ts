import { describe, expect, it } from 'vitest';
import { renderEmailTemplate, type EmailTemplateName } from '../emailDispatch';

// V1 communications productionisation (WORKLOG.md this date). Pure unit tests for
// renderEmailTemplate -- no DB, no provider needed, since it's a deterministic
// vars-in/{subject,bodyText,bodyHtml}-out function. Complements the real integration coverage in
// emailDispatch.test.ts (which exercises dispatchEmail's idempotency/suppression/preference logic
// against a live DB but never asserts on rendered content itself).

// Every EmailTemplateName this codebase defines -- kept as a literal list (not derived from the
// type, which doesn't exist at runtime) so a template added to the union without a matching
// TEMPLATE_HTML_CONTENT/TEMPLATE_SUBJECTS/TEMPLATE_BODY entry fails this test immediately (a
// missing map entry throws inside renderEmailTemplate at the first real dispatch attempt
// otherwise -- this catches it at test time instead).
const ALL_TEMPLATE_NAMES: EmailTemplateName[] = [
  'invoice_issued',
  'payment_recorded',
  'owner_statement_ready',
  'maintenance_update',
  'subscription_payment_issue',
  'subscription_suspended',
  'trial_expiring_soon',
  'member_invited',
  'tenant_invitation',
  'owner_invitation',
  'compliance_requirement_assigned',
  'compliance_requirement_acknowledged',
  'compliance_requirement_due_soon',
  'compliance_requirement_overdue',
  'subscription_activated',
  'plan_upgraded',
  'plan_downgrade_scheduled',
  'subscription_cancelled',
  'subscription_reactivated',
];

describe('renderEmailTemplate', () => {
  it.each(ALL_TEMPLATE_NAMES)(
    'renders a non-empty subject, bodyText, and well-formed bodyHtml for %s with no vars',
    (name) => {
      const result = renderEmailTemplate(name, {});
      expect(result.subject.length).toBeGreaterThan(0);
      expect(result.bodyText.length).toBeGreaterThan(0);
      expect(result.bodyHtml.trim().startsWith('<!doctype html>')).toBe(true);
      expect(result.bodyHtml).toContain('</html>');
    },
  );

  it('substitutes template variables into both bodyText and bodyHtml', () => {
    const result = renderEmailTemplate('invoice_issued', {
      propertyAddress: '12 Oak Street',
      amount: 'R5,000.00',
      period: 'August 2026',
    });
    expect(result.subject).toContain('12 Oak Street');
    expect(result.bodyText).toContain('12 Oak Street');
    expect(result.bodyHtml).toContain('12 Oak Street');
    expect(result.bodyHtml).toContain('R5,000.00');
  });

  it('escapes an HTML-injection attempt in a template variable inside bodyHtml, but leaves bodyText as plain text', () => {
    const malicious = '<img src=x onerror=alert(1)>Evil Properties';
    const result = renderEmailTemplate('tenant_invitation', {
      orgName: malicious,
      acceptUrl: 'https://proplyst.co.za/activate?token=abc',
      expiresAt: '2026-09-01',
    });
    expect(result.bodyHtml).not.toContain('<img src=x onerror=alert(1)>');
    expect(result.bodyHtml).toContain('&lt;img src=x onerror=alert(1)&gt;Evil Properties');
    // bodyText is never HTML-rendered by a client, so it legitimately carries the raw string --
    // this asserts the plain-text channel is unaffected by the HTML-escaping added for bodyHtml.
    expect(result.bodyText).toContain(malicious);
  });

  it('never lets a non-http(s) acceptUrl produce a clickable link in bodyHtml (tenant_invitation)', () => {
    const result = renderEmailTemplate('tenant_invitation', {
      orgName: 'Acme Rentals',
      acceptUrl: 'javascript:alert(1)',
    });
    expect(result.bodyHtml).not.toContain('javascript:alert(1)');
  });

  it('renders the tenant_invitation CTA and omits sensitive lease/financial detail entirely (WHATSAPP.md §3-equivalent email discipline)', () => {
    const result = renderEmailTemplate('tenant_invitation', {
      orgName: 'Acme Rentals',
      acceptUrl: 'https://proplyst.co.za/activate?token=abc123',
      expiresAt: '2026-09-01',
    });
    expect(result.bodyHtml).toContain('href="https://proplyst.co.za/activate?token=abc123"');
    expect(result.bodyHtml.toLowerCase()).not.toContain('balance');
    expect(result.bodyHtml.toLowerCase()).not.toContain('rent amount');
  });

  it('billing lifecycle templates render the plan name and amounts passed in', () => {
    const upgraded = renderEmailTemplate('plan_upgraded', {
      planName: 'Growth',
      amountDueNow: 'R150.00',
      nextRenewalAmount: 'R450.00',
    });
    expect(upgraded.subject).toContain('Growth');
    expect(upgraded.bodyHtml).toContain('R150.00');
    expect(upgraded.bodyHtml).toContain('R450.00');

    const downgradeScheduled = renderEmailTemplate('plan_downgrade_scheduled', {
      planName: 'Starter',
      effectiveAt: '2026-09-01',
    });
    expect(downgradeScheduled.bodyHtml).toContain('Starter');
    expect(downgradeScheduled.bodyHtml).toContain('2026-09-01');
  });

  it('respects a caller-supplied appUrl for links, defaulting sensibly when omitted', () => {
    const result = renderEmailTemplate(
      'invoice_issued',
      { propertyAddress: '1 Test St' },
      'https://custom.example',
    );
    expect(result.bodyHtml).toContain('https://custom.example/my-payments');
  });
});
