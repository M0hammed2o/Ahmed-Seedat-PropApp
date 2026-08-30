import { describe, expect, it } from 'vitest';
import { deriveTenantPortalStatus } from '../tenantPortalStatus';

const iso = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();

describe('deriveTenantPortalStatus', () => {
  it('is "Active" whenever userId is set, regardless of invitation history', () => {
    expect(deriveTenantPortalStatus('user-1', [])).toEqual({ status: 'active', label: 'Active' });
  });

  it('is "Not invited" when there is no userId and no invitations at all', () => {
    expect(deriveTenantPortalStatus(null, [])).toEqual({
      status: 'not_invited',
      label: 'Not invited',
    });
  });

  it('is "Invitation pending" for a non-accepted, non-revoked, non-expired invitation', () => {
    const result = deriveTenantPortalStatus(null, [
      { acceptedAt: null, revokedAt: null, expiresAt: iso(5), createdAt: iso(-1) },
    ]);
    expect(result).toEqual({ status: 'pending', label: 'Invitation pending' });
  });

  it('is "Invitation expired" once the most recent invitation has passed its expiry', () => {
    const result = deriveTenantPortalStatus(null, [
      { acceptedAt: null, revokedAt: null, expiresAt: iso(-1), createdAt: iso(-8) },
    ]);
    expect(result).toEqual({ status: 'expired', label: 'Invitation expired' });
  });

  it('falls back to "Not invited" when the most recent invitation was revoked', () => {
    const result = deriveTenantPortalStatus(null, [
      { acceptedAt: null, revokedAt: iso(-1), expiresAt: iso(5), createdAt: iso(-2) },
    ]);
    expect(result).toEqual({ status: 'not_invited', label: 'Not invited' });
  });

  it('uses only the MOST RECENT invitation when a tenant has several over time', () => {
    const result = deriveTenantPortalStatus(null, [
      { acceptedAt: null, revokedAt: null, expiresAt: iso(-10), createdAt: iso(-20) }, // old, expired
      { acceptedAt: null, revokedAt: null, expiresAt: iso(5), createdAt: iso(-1) }, // newest, pending
    ]);
    expect(result).toEqual({ status: 'pending', label: 'Invitation pending' });
  });
});
