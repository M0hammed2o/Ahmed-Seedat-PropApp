import { describe, expect, it } from 'vitest';
import { renderEmailTemplate } from '../emailDispatch';

// Tenant onboarding completion pass (WORKLOG.md this date): pure rendering test, no DB/provider
// needed -- the audit found `emailDispatch.test.ts` only ever asserted on member_invited's
// subject via a real email_messages row (which never stores body text at all), so
// tenant_invitation/owner_invitation shipped with a body that silently never interpolated
// acceptUrl. This file asserts on the real rendered body string directly, closing that gap for
// every template that carries a link.

describe('renderEmailTemplate', () => {
  it('includes acceptUrl in the tenant_invitation body', () => {
    const { bodyText } = renderEmailTemplate('tenant_invitation', {
      orgName: 'Musgrave Property Group',
      tenantName: 'Ahmed Patel',
      acceptUrl: 'https://app.proplyst.com/activate?token=abc123',
      expiresAt: '18 Aug 2026',
    });
    expect(bodyText).toContain('https://app.proplyst.com/activate?token=abc123');
    expect(bodyText).toContain('Musgrave Property Group');
    expect(bodyText).toContain('18 Aug 2026');
  });

  it('includes acceptUrl in the owner_invitation body', () => {
    const { bodyText } = renderEmailTemplate('owner_invitation', {
      orgName: 'Musgrave Property Group',
      ownerName: 'Sarah Owner',
      acceptUrl: 'https://app.proplyst.com/owner-invitations/accept?token=xyz789',
      expiresAt: '18 Aug 2026',
    });
    expect(bodyText).toContain('https://app.proplyst.com/owner-invitations/accept?token=xyz789');
    expect(bodyText).toContain('Musgrave Property Group');
    expect(bodyText).toContain('18 Aug 2026');
  });

  it('still includes acceptUrl in the staff member_invited body (regression guard)', () => {
    const { bodyText } = renderEmailTemplate('member_invited', {
      orgName: 'Musgrave Property Group',
      inviterName: 'Jane Admin',
      role: 'agent',
      acceptUrl: 'https://app.proplyst.com/invitations/accept?token=def456',
    });
    expect(bodyText).toContain('https://app.proplyst.com/invitations/accept?token=def456');
  });

  it('degrades gracefully when acceptUrl/expiresAt are not supplied, without throwing', () => {
    expect(() => renderEmailTemplate('tenant_invitation', {})).not.toThrow();
    expect(() => renderEmailTemplate('owner_invitation', {})).not.toThrow();
    const { bodyText } = renderEmailTemplate('tenant_invitation', {});
    expect(bodyText).not.toContain('undefined');
  });
});
