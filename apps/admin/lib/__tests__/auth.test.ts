import { describe, expect, it, vi, beforeEach } from 'vitest';

// Super Admin separation (WORKLOG.md this date): pins getAdminSession()'s two new fail-closed
// conditions -- AAL2 required, and the optional email allow-list -- plus that
// getAdminSessionWithoutMfaCheck() deliberately does NOT apply the AAL2 check (the one thing the
// (super-admin) layout needs it for: distinguishing "not an admin" from "admin, needs to finish
// MFA").

let demoMode = false;
vi.mock('../demoMode', () => ({
  get ADMIN_DEMO_MODE() {
    return demoMode;
  },
}));

const mockGetUser = vi.fn();
const mockGetAal = vi.fn();
const mockFrom = vi.fn();
vi.mock('../supabase/server', () => ({
  getServerSupabaseClient: () => ({
    auth: {
      getUser: mockGetUser,
      mfa: { getAuthenticatorAssuranceLevel: mockGetAal },
    },
  }),
  getServiceRoleClient: () => ({ from: mockFrom }),
}));

function mockPlatformAdminRow(overrides: Partial<Record<string, unknown>> = {}) {
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: {
            id: 'admin-row-1',
            role: 'super_admin',
            display_name: 'Test Admin',
            is_active: true,
            ...overrides,
          },
          error: null,
        }),
      }),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  demoMode = false;
  delete process.env.PLATFORM_ADMIN_ALLOWED_EMAILS;
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'admin@example.com' } } });
  mockGetAal.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null });
  mockPlatformAdminRow();
});

describe('getAdminSessionWithoutMfaCheck', () => {
  it('returns null when there is no authenticated user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { getAdminSessionWithoutMfaCheck } = await import('../auth');
    expect(await getAdminSessionWithoutMfaCheck()).toBeNull();
  });

  it('returns null when the user has no platform_admin_users row', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    });
    const { getAdminSessionWithoutMfaCheck } = await import('../auth');
    expect(await getAdminSessionWithoutMfaCheck()).toBeNull();
  });

  it('returns null when the platform_admin_users row is inactive', async () => {
    mockPlatformAdminRow({ is_active: false });
    const { getAdminSessionWithoutMfaCheck } = await import('../auth');
    expect(await getAdminSessionWithoutMfaCheck()).toBeNull();
  });

  it('returns the session for a real, active admin -- regardless of MFA/AAL state', async () => {
    mockGetAal.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal1' },
      error: null,
    });
    const { getAdminSessionWithoutMfaCheck } = await import('../auth');
    const session = await getAdminSessionWithoutMfaCheck();
    // AAL1, not AAL2 -- and the returned session is still non-null, confirming this function
    // genuinely doesn't gate on AAL at all (resolveAdminGate() fetches AAL alongside the DB
    // lookup for efficiency, but only getAdminSession()/getAdminGateStatus() ever act on it).
    expect(session).toEqual({
      id: 'admin-row-1',
      authUserId: 'user-1',
      role: 'super_admin',
      displayName: 'Test Admin',
    });
  });

  it('rejects a real admin whose email is not on an active allow-list', async () => {
    process.env.PLATFORM_ADMIN_ALLOWED_EMAILS = 'someone-else@example.com';
    const { getAdminSessionWithoutMfaCheck } = await import('../auth');
    expect(await getAdminSessionWithoutMfaCheck()).toBeNull();
    // Fails before ever querying platform_admin_users -- the allow-list is a check on its own,
    // not merely a filter applied after the DB lookup.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('allows a real admin whose email IS on an active allow-list', async () => {
    process.env.PLATFORM_ADMIN_ALLOWED_EMAILS = 'someone-else@example.com, admin@example.com';
    const { getAdminSessionWithoutMfaCheck } = await import('../auth');
    expect(await getAdminSessionWithoutMfaCheck()).not.toBeNull();
  });

  it('does not apply the allow-list at all when unset', async () => {
    const { getAdminSessionWithoutMfaCheck } = await import('../auth');
    expect(await getAdminSessionWithoutMfaCheck()).not.toBeNull();
  });
});

describe('getAdminSession (AAL2-enforcing)', () => {
  it('returns the session when AAL2 is satisfied', async () => {
    mockGetAal.mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    });
    const { getAdminSession } = await import('../auth');
    expect(await getAdminSession()).not.toBeNull();
  });

  it('returns null for a real admin whose session is only AAL1 (never enrolled MFA)', async () => {
    mockGetAal.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal1' },
      error: null,
    });
    const { getAdminSession } = await import('../auth');
    expect(await getAdminSession()).toBeNull();
  });

  it('returns null for a real admin mid-step-up (AAL1 current, AAL2 required)', async () => {
    mockGetAal.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    });
    const { getAdminSession } = await import('../auth');
    expect(await getAdminSession()).toBeNull();
  });

  it('returns null outright for a non-admin, whatever their AAL happens to be', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    });
    mockGetAal.mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    });
    const { getAdminSession } = await import('../auth');
    expect(await getAdminSession()).toBeNull();
  });

  it('demo mode is exempt from the AAL2 check entirely', async () => {
    demoMode = true;
    mockGetAal.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal1' },
      error: null,
    });
    const { getAdminSession } = await import('../auth');
    expect(await getAdminSession()).not.toBeNull();
    expect(mockGetAal).not.toHaveBeenCalled();
  });
});
