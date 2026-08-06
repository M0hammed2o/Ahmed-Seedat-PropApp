import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getAdminGateStatus } from '../auth';
import { resolvePortalSession } from '../orgSession';
import { resolveTenantSession } from '../tenantSession';
import { resolveOwnerSession } from '../ownerSession';
import { resolveAuthenticatedDestination } from '../destinationResolver';

// Root-domain routing fix (WORKLOG.md this date): pins the centralized priority order every
// authenticated caller is routed by -- platform admin > active org (dashboard, or
// access-restricted if every active org is suspended/cancelled) > tenant > owner >
// authenticated-with-nothing (onboarding) > unauthenticated (null, the caller renders the public
// landing page instead of redirecting).

vi.mock('../auth', () => ({ getAdminGateStatus: vi.fn() }));
vi.mock('../orgSession', () => ({ resolvePortalSession: vi.fn() }));
vi.mock('../tenantSession', () => ({ resolveTenantSession: vi.fn() }));
vi.mock('../ownerSession', () => ({ resolveOwnerSession: vi.fn() }));

const mockGetAdminGateStatus = vi.mocked(getAdminGateStatus);
const mockResolvePortalSession = vi.mocked(resolvePortalSession);
const mockResolveTenantSession = vi.mocked(resolveTenantSession);
const mockResolveOwnerSession = vi.mocked(resolveOwnerSession);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminGateStatus.mockResolvedValue({ session: null, isAal2: false });
  mockResolvePortalSession.mockResolvedValue(null);
  mockResolveTenantSession.mockResolvedValue(null);
  mockResolveOwnerSession.mockResolvedValue(null);
});

describe('resolveAuthenticatedDestination', () => {
  it('returns null for a genuinely unauthenticated caller', async () => {
    expect(await resolveAuthenticatedDestination()).toBeNull();
  });

  it('routes an AAL2 platform admin to /overview, ahead of every other identity', async () => {
    mockGetAdminGateStatus.mockResolvedValue({
      session: { id: 'admin-1', authUserId: 'user-1', role: 'super_admin', displayName: 'Admin' },
      isAal2: true,
    });
    // Even with an active org membership present, platform-admin wins.
    mockResolvePortalSession.mockResolvedValue({
      userId: 'user-1',
      organizations: [{ orgId: 'org-1', role: 'principal', status: 'active', orgStatus: 'active' }],
      ownerIdentities: [],
      isPlatformAdmin: true,
      supportSessions: [],
    });

    const destination = await resolveAuthenticatedDestination();
    expect(destination).toEqual({ kind: 'platform-admin', path: '/platform-admin/overview' });
  });

  it('routes a platform admin who has not completed MFA straight to /platform-admin/mfa-setup, not /overview', async () => {
    // Collapses what used to be two chained server-side redirects (/ -> overview -> mfa-setup)
    // into one -- see this file's own comment for the real, live-caught Next.js dev-server bug
    // that chain reproducibly triggered.
    mockGetAdminGateStatus.mockResolvedValue({
      session: { id: 'admin-1', authUserId: 'user-1', role: 'super_admin', displayName: 'Admin' },
      isAal2: false,
    });

    const destination = await resolveAuthenticatedDestination();
    expect(destination).toEqual({ kind: 'platform-admin', path: '/platform-admin/mfa-setup' });
  });

  it('routes a normal active-org member to /dashboard', async () => {
    mockResolvePortalSession.mockResolvedValue({
      userId: 'user-1',
      organizations: [{ orgId: 'org-1', role: 'principal', status: 'active', orgStatus: 'active' }],
      ownerIdentities: [],
      isPlatformAdmin: false,
      supportSessions: [],
    });

    expect(await resolveAuthenticatedDestination()).toEqual({
      kind: 'org-dashboard',
      path: '/dashboard',
    });
  });

  it('routes a member of a suspended org to /access-restricted', async () => {
    mockResolvePortalSession.mockResolvedValue({
      userId: 'user-1',
      organizations: [
        { orgId: 'org-1', role: 'principal', status: 'active', orgStatus: 'suspended' },
      ],
      ownerIdentities: [],
      isPlatformAdmin: false,
      supportSessions: [],
    });

    expect(await resolveAuthenticatedDestination()).toEqual({
      kind: 'org-restricted',
      path: '/access-restricted',
    });
  });

  it('routes a member of a cancelled org to /access-restricted', async () => {
    mockResolvePortalSession.mockResolvedValue({
      userId: 'user-1',
      organizations: [
        { orgId: 'org-1', role: 'principal', status: 'active', orgStatus: 'cancelled' },
      ],
      ownerIdentities: [],
      isPlatformAdmin: false,
      supportSessions: [],
    });

    expect(await resolveAuthenticatedDestination()).toEqual({
      kind: 'org-restricted',
      path: '/access-restricted',
    });
  });

  it('does NOT restrict an overdue org -- still within its billing grace period', async () => {
    mockResolvePortalSession.mockResolvedValue({
      userId: 'user-1',
      organizations: [
        { orgId: 'org-1', role: 'principal', status: 'active', orgStatus: 'overdue' },
      ],
      ownerIdentities: [],
      isPlatformAdmin: false,
      supportSessions: [],
    });

    expect(await resolveAuthenticatedDestination()).toEqual({
      kind: 'org-dashboard',
      path: '/dashboard',
    });
  });

  it('reaches /dashboard if ANY active org is usable, even if another is suspended', async () => {
    mockResolvePortalSession.mockResolvedValue({
      userId: 'user-1',
      organizations: [
        { orgId: 'org-1', role: 'viewer', status: 'active', orgStatus: 'suspended' },
        { orgId: 'org-2', role: 'principal', status: 'active', orgStatus: 'active' },
      ],
      ownerIdentities: [],
      isPlatformAdmin: false,
      supportSessions: [],
    });

    expect(await resolveAuthenticatedDestination()).toEqual({
      kind: 'org-dashboard',
      path: '/dashboard',
    });
  });

  it('only restricts when EVERY active org is suspended/cancelled', async () => {
    mockResolvePortalSession.mockResolvedValue({
      userId: 'user-1',
      organizations: [
        { orgId: 'org-1', role: 'viewer', status: 'active', orgStatus: 'suspended' },
        { orgId: 'org-2', role: 'principal', status: 'active', orgStatus: 'cancelled' },
      ],
      ownerIdentities: [],
      isPlatformAdmin: false,
      supportSessions: [],
    });

    expect(await resolveAuthenticatedDestination()).toEqual({
      kind: 'org-restricted',
      path: '/access-restricted',
    });
  });

  it('ignores a non-active (invited/revoked) membership entirely', async () => {
    mockResolvePortalSession.mockResolvedValue({
      userId: 'user-1',
      organizations: [{ orgId: 'org-1', role: 'agent', status: 'invited', orgStatus: 'active' }],
      ownerIdentities: [],
      isPlatformAdmin: false,
      supportSessions: [],
    });
    mockResolveTenantSession.mockResolvedValue({
      userId: 'user-1',
      tenantId: 't-1',
      orgId: 'org-1',
    });

    expect(await resolveAuthenticatedDestination()).toEqual({
      kind: 'tenant-portal',
      path: '/portal',
    });
  });

  it('routes a tenant identity to /portal when there is no active org membership', async () => {
    mockResolveTenantSession.mockResolvedValue({
      userId: 'user-1',
      tenantId: 't-1',
      orgId: 'org-1',
    });

    expect(await resolveAuthenticatedDestination()).toEqual({
      kind: 'tenant-portal',
      path: '/portal',
    });
  });

  it('routes an owner identity to /owner-portal when there is no org or tenant identity', async () => {
    mockResolveOwnerSession.mockResolvedValue({ userId: 'user-1', ownerId: 'o-1', orgId: 'org-1' });

    expect(await resolveAuthenticatedDestination()).toEqual({
      kind: 'owner-portal',
      path: '/owner-portal',
    });
  });

  it('routes an authenticated caller with zero identities to onboarding', async () => {
    mockResolvePortalSession.mockResolvedValue({
      userId: 'user-1',
      organizations: [],
      ownerIdentities: [],
      isPlatformAdmin: false,
      supportSessions: [],
    });

    expect(await resolveAuthenticatedDestination()).toEqual({
      kind: 'onboarding',
      path: '/onboarding/create-organization',
    });
  });
});
