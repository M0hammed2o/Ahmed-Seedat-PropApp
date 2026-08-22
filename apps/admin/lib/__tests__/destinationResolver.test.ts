import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getAdminGateStatus } from '../auth';
import { resolvePortalSession } from '../orgSession';
import { resolveTenantSession } from '../tenantSession';
import { resolveOwnerSession } from '../ownerSession';
import { hasAcceptedCurrentLegalTerms } from '../legalConsent';
import { isProfileComplete } from '../profileCompletion';
import { mayCreatePortfolio } from '../subscriptionEntitlements';
import { resolveAuthenticatedDestination } from '../destinationResolver';

// Commercial plan restructure: mocks the one Supabase query resolveCustomerOnboardingGate's own
// hasIncompleteCommercialSetup() makes (organizations.commercial_setup_completed_at is null for
// any of the caller's principal org ids). Defaults to "nothing incomplete" (mockSetupQuery
// resolves to an empty array) so every pre-existing test above keeps testing exactly what it
// always tested, matching this file's own established convention for the consent/profile mocks.
const mockSetupQuery = vi.fn();
// Staff invitation flow audit (this date): destinationResolver's new pending-invitation backstop
// reads the caller's own email via getServerSupabaseClient().auth.getUser(), then looks up a
// pending invite via getServiceRoleClient() (RLS on organization_invites only allows a same-org
// SELECT, which a zero-membership caller never satisfies -- see the function's own comment).
const mockGetUser = vi.fn();
const mockInviteMaybeSingle = vi.fn();
vi.mock('../supabase/server', () => ({
  getServerSupabaseClient: () => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({
        in: () => ({
          is: () => ({ limit: mockSetupQuery }),
        }),
      }),
    }),
  }),
  getServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            is: () => ({
              gt: () => ({
                order: () => ({
                  limit: () => ({ maybeSingle: mockInviteMaybeSingle }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

// Root-domain routing fix (WORKLOG.md this date): pins the centralized priority order every
// authenticated caller is routed by -- platform admin > active org (legal-consent/profile-
// completion gates, then dashboard, or access-restricted if every active org is
// suspended/cancelled) > tenant > owner > authenticated-with-nothing (legal-consent/profile-
// completion gates, then onboarding) > unauthenticated (null, the caller renders the public
// landing page instead of redirecting).

vi.mock('../auth', () => ({ getAdminGateStatus: vi.fn() }));
vi.mock('../orgSession', () => ({ resolvePortalSession: vi.fn() }));
vi.mock('../tenantSession', () => ({ resolveTenantSession: vi.fn() }));
vi.mock('../ownerSession', () => ({ resolveOwnerSession: vi.fn() }));
vi.mock('../legalConsent', () => ({ hasAcceptedCurrentLegalTerms: vi.fn() }));
vi.mock('../profileCompletion', () => ({ isProfileComplete: vi.fn() }));
vi.mock('../subscriptionEntitlements', () => ({ mayCreatePortfolio: vi.fn() }));

const mockGetAdminGateStatus = vi.mocked(getAdminGateStatus);
const mockResolvePortalSession = vi.mocked(resolvePortalSession);
const mockResolveTenantSession = vi.mocked(resolveTenantSession);
const mockResolveOwnerSession = vi.mocked(resolveOwnerSession);
const mockHasAcceptedCurrentLegalTerms = vi.mocked(hasAcceptedCurrentLegalTerms);
const mockIsProfileComplete = vi.mocked(isProfileComplete);
const mockMayCreatePortfolio = vi.mocked(mayCreatePortfolio);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminGateStatus.mockResolvedValue({ session: null, isAal2: false });
  mockResolvePortalSession.mockResolvedValue(null);
  mockResolveTenantSession.mockResolvedValue(null);
  mockResolveOwnerSession.mockResolvedValue(null);
  // Defaults to "already complete" so every pre-existing test below (written before the
  // legal-consent/profile-completion gates existed) keeps testing exactly what it always tested --
  // org/tenant/owner/admin resolution -- without also having to know about these two new,
  // orthogonal gates. The gates get their own dedicated test cases further down.
  mockHasAcceptedCurrentLegalTerms.mockResolvedValue(true);
  mockIsProfileComplete.mockResolvedValue(true);
  mockSetupQuery.mockResolvedValue({ data: [] });
  // Commercial onboarding bypass fix (this date): defaults to "ordinary, portfolio-eligible
  // signup" (the common case) so every pre-existing test below that reaches the zero-membership
  // branch keeps testing what it always tested. The "linked owner/tenant only" case gets its own
  // dedicated test further down.
  mockMayCreatePortfolio.mockResolvedValue(true);
  // Staff invitation flow audit (this date): defaults to "no pending invitation" so every
  // pre-existing test below keeps testing exactly what it always tested. The invitation-backstop
  // case gets its own dedicated tests further down.
  mockGetUser.mockResolvedValue({ data: { user: { email: 'caller@example.com' } } });
  mockInviteMaybeSingle.mockResolvedValue({ data: null });
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
      propertyId: null,
      propertyNickname: null,
      unitId: null,
      unitLabel: null,
      leaseId: null,
      tenancies: [],
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
      propertyId: null,
      propertyNickname: null,
      unitId: null,
      unitLabel: null,
      leaseId: null,
      tenancies: [],
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

  it('routes a portfolio-eligible authenticated caller with zero identities to /onboarding/choose-plan (commercial onboarding bypass fix)', async () => {
    mockResolvePortalSession.mockResolvedValue({
      userId: 'user-1',
      organizations: [],
      ownerIdentities: [],
      isPlatformAdmin: false,
      supportSessions: [],
    });
    mockMayCreatePortfolio.mockResolvedValue(true);

    expect(await resolveAuthenticatedDestination()).toEqual({
      kind: 'onboarding',
      path: '/onboarding/choose-plan',
    });
  });

  it('still routes a linked-owner/tenant-only (not portfolio-eligible) caller with zero memberships to /onboarding/create-organization', async () => {
    mockResolvePortalSession.mockResolvedValue({
      userId: 'user-1',
      organizations: [],
      ownerIdentities: [],
      isPlatformAdmin: false,
      supportSessions: [],
    });
    mockMayCreatePortfolio.mockResolvedValue(false);

    expect(await resolveAuthenticatedDestination()).toEqual({
      kind: 'onboarding',
      path: '/onboarding/create-organization',
    });
  });

  describe('pending-invitation backstop (staff invitation flow audit, this date)', () => {
    it('routes a zero-membership caller with a valid pending invitation matching their email to /invitations/accept, not choose-plan', async () => {
      mockResolvePortalSession.mockResolvedValue({
        userId: 'user-1',
        organizations: [],
        ownerIdentities: [],
        isPlatformAdmin: false,
        supportSessions: [],
      });
      mockMayCreatePortfolio.mockResolvedValue(true);
      mockGetUser.mockResolvedValue({ data: { user: { email: 'invitee@example.com' } } });
      mockInviteMaybeSingle.mockResolvedValue({ data: { token: 'abc-123-token' } });

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'onboarding',
        path: '/invitations/accept?token=abc-123-token',
      });
    });

    it('the invitation backstop takes priority even for a NOT portfolio-eligible (linked-owner-only) caller', async () => {
      mockResolvePortalSession.mockResolvedValue({
        userId: 'user-1',
        organizations: [],
        ownerIdentities: [],
        isPlatformAdmin: false,
        supportSessions: [],
      });
      mockMayCreatePortfolio.mockResolvedValue(false);
      mockInviteMaybeSingle.mockResolvedValue({ data: { token: 'linked-owner-invite-token' } });

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'onboarding',
        path: '/invitations/accept?token=linked-owner-invite-token',
      });
    });

    it('falls through to choose-plan when no pending invitation exists (the ordinary new-customer case, unaffected)', async () => {
      mockResolvePortalSession.mockResolvedValue({
        userId: 'user-1',
        organizations: [],
        ownerIdentities: [],
        isPlatformAdmin: false,
        supportSessions: [],
      });
      mockMayCreatePortfolio.mockResolvedValue(true);
      mockInviteMaybeSingle.mockResolvedValue({ data: null });

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'onboarding',
        path: '/onboarding/choose-plan',
      });
    });

    it('never consults the invitation backstop for an active org member (existing membership routing is completely unaffected)', async () => {
      mockResolvePortalSession.mockResolvedValue({
        userId: 'user-1',
        organizations: [
          { orgId: 'org-1', role: 'principal', status: 'active', orgStatus: 'active' },
        ],
        ownerIdentities: [],
        isPlatformAdmin: false,
        supportSessions: [],
      });

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'org-dashboard',
        path: '/dashboard',
      });
      expect(mockInviteMaybeSingle).not.toHaveBeenCalled();
    });

    it('does not crash and falls through normally if the caller has no resolvable email', async () => {
      mockResolvePortalSession.mockResolvedValue({
        userId: 'user-1',
        organizations: [],
        ownerIdentities: [],
        isPlatformAdmin: false,
        supportSessions: [],
      });
      mockGetUser.mockResolvedValue({ data: { user: null } });

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'onboarding',
        path: '/onboarding/choose-plan',
      });
      expect(mockInviteMaybeSingle).not.toHaveBeenCalled();
    });
  });

  describe('legal-consent / profile-completion gates (production signup/onboarding, WORKLOG.md this date)', () => {
    it('gates an active-org member to /legal-consent before /dashboard when consent is missing', async () => {
      mockResolvePortalSession.mockResolvedValue({
        userId: 'user-1',
        organizations: [
          { orgId: 'org-1', role: 'principal', status: 'active', orgStatus: 'active' },
        ],
        ownerIdentities: [],
        isPlatformAdmin: false,
        supportSessions: [],
      });
      mockHasAcceptedCurrentLegalTerms.mockResolvedValue(false);

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'legal-consent',
        path: '/legal-consent',
      });
    });

    it('gates an active-org member to /complete-account (not /legal-consent) when consent is done but profile is not', async () => {
      mockResolvePortalSession.mockResolvedValue({
        userId: 'user-1',
        organizations: [
          { orgId: 'org-1', role: 'principal', status: 'active', orgStatus: 'active' },
        ],
        ownerIdentities: [],
        isPlatformAdmin: false,
        supportSessions: [],
      });
      mockHasAcceptedCurrentLegalTerms.mockResolvedValue(true);
      mockIsProfileComplete.mockResolvedValue(false);

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'profile-incomplete',
        path: '/complete-account',
      });
    });

    it('gates a no-org caller to /legal-consent before onboarding', async () => {
      mockResolvePortalSession.mockResolvedValue({
        userId: 'user-1',
        organizations: [],
        ownerIdentities: [],
        isPlatformAdmin: false,
        supportSessions: [],
      });
      mockHasAcceptedCurrentLegalTerms.mockResolvedValue(false);

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'legal-consent',
        path: '/legal-consent',
      });
    });

    it('never gates platform admin on consent/profile -- Super Admin stays completely separate', async () => {
      mockGetAdminGateStatus.mockResolvedValue({
        session: { id: 'admin-1', authUserId: 'user-1', role: 'super_admin', displayName: 'Admin' },
        isAal2: true,
      });
      mockHasAcceptedCurrentLegalTerms.mockResolvedValue(false);
      mockIsProfileComplete.mockResolvedValue(false);

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'platform-admin',
        path: '/platform-admin/overview',
      });
      expect(mockHasAcceptedCurrentLegalTerms).not.toHaveBeenCalled();
      expect(mockIsProfileComplete).not.toHaveBeenCalled();
    });

    it('never gates a tenant identity on consent/profile', async () => {
      mockResolveTenantSession.mockResolvedValue({
        userId: 'user-1',
        tenantId: 't-1',
        orgId: 'org-1',
        propertyId: null,
        propertyNickname: null,
        unitId: null,
        unitLabel: null,
        leaseId: null,
        tenancies: [],
      });
      mockHasAcceptedCurrentLegalTerms.mockResolvedValue(false);
      mockIsProfileComplete.mockResolvedValue(false);

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'tenant-portal',
        path: '/portal',
      });
    });

    it('never gates an owner identity on consent/profile', async () => {
      mockResolveOwnerSession.mockResolvedValue({
        userId: 'user-1',
        ownerId: 'o-1',
        orgId: 'org-1',
      });
      mockHasAcceptedCurrentLegalTerms.mockResolvedValue(false);
      mockIsProfileComplete.mockResolvedValue(false);

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'owner-portal',
        path: '/owner-portal',
      });
    });

    it('never gates a suspended-org (access-restricted) member on consent/profile', async () => {
      mockResolvePortalSession.mockResolvedValue({
        userId: 'user-1',
        organizations: [
          { orgId: 'org-1', role: 'principal', status: 'active', orgStatus: 'suspended' },
        ],
        ownerIdentities: [],
        isPlatformAdmin: false,
        supportSessions: [],
      });
      mockHasAcceptedCurrentLegalTerms.mockResolvedValue(false);
      mockIsProfileComplete.mockResolvedValue(false);

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'org-restricted',
        path: '/access-restricted',
      });
    });
  });

  describe('commercial-setup gate (commercial plan restructure -- indefinite-trial blocker fix)', () => {
    it('gates a principal of a not-yet-set-up org to /organization/billing/setup, ahead of /dashboard', async () => {
      mockResolvePortalSession.mockResolvedValue({
        userId: 'user-1',
        organizations: [
          { orgId: 'org-1', role: 'principal', status: 'active', orgStatus: 'active' },
        ],
        ownerIdentities: [],
        isPlatformAdmin: false,
        supportSessions: [],
      });
      mockSetupQuery.mockResolvedValue({ data: [{ id: 'org-1' }] });

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'commercial-setup',
        path: '/organization/billing/setup',
      });
    });

    it('does NOT gate a non-principal (staff/agent) member on an org still mid-setup', async () => {
      mockResolvePortalSession.mockResolvedValue({
        userId: 'user-1',
        organizations: [{ orgId: 'org-1', role: 'agent', status: 'active', orgStatus: 'active' }],
        ownerIdentities: [],
        isPlatformAdmin: false,
        supportSessions: [],
      });
      // The query is scoped to principal org ids only -- an agent membership never queries at
      // all (principalOrgIds is empty), matching hasIncompleteCommercialSetup's own early return.

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'org-dashboard',
        path: '/dashboard',
      });
      expect(mockSetupQuery).not.toHaveBeenCalled();
    });

    it('does not gate a principal whose org has already completed commercial setup', async () => {
      mockResolvePortalSession.mockResolvedValue({
        userId: 'user-1',
        organizations: [
          { orgId: 'org-1', role: 'principal', status: 'active', orgStatus: 'active' },
        ],
        ownerIdentities: [],
        isPlatformAdmin: false,
        supportSessions: [],
      });
      mockSetupQuery.mockResolvedValue({ data: [] });

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'org-dashboard',
        path: '/dashboard',
      });
    });

    it('checks commercial setup AFTER consent and profile completion, not before', async () => {
      mockResolvePortalSession.mockResolvedValue({
        userId: 'user-1',
        organizations: [
          { orgId: 'org-1', role: 'principal', status: 'active', orgStatus: 'active' },
        ],
        ownerIdentities: [],
        isPlatformAdmin: false,
        supportSessions: [],
      });
      mockHasAcceptedCurrentLegalTerms.mockResolvedValue(false);
      mockSetupQuery.mockResolvedValue({ data: [{ id: 'org-1' }] });

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'legal-consent',
        path: '/legal-consent',
      });
      expect(mockSetupQuery).not.toHaveBeenCalled();
    });

    it('never gates platform admin, tenant, or owner identities on commercial setup', async () => {
      mockResolveOwnerSession.mockResolvedValue({ userId: 'user-1', ownerId: 'o-1', orgId: 'org-1' });
      mockSetupQuery.mockResolvedValue({ data: [{ id: 'org-1' }] });

      expect(await resolveAuthenticatedDestination()).toEqual({
        kind: 'owner-portal',
        path: '/owner-portal',
      });
      expect(mockSetupQuery).not.toHaveBeenCalled();
    });
  });
});
