// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// Security review finding (V1 commercial onboarding pass): a caller who is authenticated (e.g.
// via a fresh Google/Apple OAuth sign-in landing here directly via ?next=) but has never accepted
// Terms/Privacy must be redirected to /legal-consent before AcceptInviteClient ever renders --
// this route sits outside resolveAuthenticatedDestination()'s own gate by design (invited-user
// continuation flows are excluded there), so this page must enforce it itself.

const mockRedirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabaseClient: async () => ({ auth: { getUser: mockGetUser } }),
}));

const mockHasAcceptedCurrentLegalTerms = vi.fn();
vi.mock('@/lib/legalConsent', () => ({
  hasAcceptedCurrentLegalTerms: mockHasAcceptedCurrentLegalTerms,
}));

// Staff invitation flow audit, follow-up (this date): profile-completion gate, added alongside
// the pre-existing legal-consent gate above -- same isProfileComplete() every customer-track
// caller is judged by, reused unchanged.
const mockIsProfileComplete = vi.fn();
vi.mock('@/lib/profileCompletion', () => ({
  isProfileComplete: mockIsProfileComplete,
}));

vi.mock('@/lib/demoMode', () => ({ ADMIN_DEMO_MODE: false }));

vi.mock('@/components/invitations/AcceptInviteClient', () => ({
  AcceptInviteClient: ({ token }: { token: string }) => (
    <div data-testid="accept-invite-client">{token}</div>
  ),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

async function renderAcceptPage(token: string) {
  const { default: AcceptInvitePage } = await import('../page');
  return AcceptInvitePage({ searchParams: Promise.resolve({ token }) });
}

describe('AcceptInvitePage (/invitations/accept)', () => {
  it('redirects an authenticated caller who has not accepted legal terms to /legal-consent, carrying the invitation URL as next', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockHasAcceptedCurrentLegalTerms.mockResolvedValue(false);

    await expect(renderAcceptPage('tok-123')).rejects.toThrow(
      'REDIRECT:/legal-consent?next=%2Finvitations%2Faccept%3Ftoken%3Dtok-123',
    );
  });

  it('renders AcceptInviteClient for an authenticated caller who has already accepted legal terms and has a complete profile', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockHasAcceptedCurrentLegalTerms.mockResolvedValue(true);
    mockIsProfileComplete.mockResolvedValue(true);

    const element = await renderAcceptPage('tok-123');
    const { getByTestId } = render(element);
    expect(getByTestId('accept-invite-client').textContent).toBe('tok-123');
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('never checks legal consent for an unauthenticated caller -- they get the sign-in prompt instead', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const element = await renderAcceptPage('tok-123');
    render(element);
    expect(mockHasAcceptedCurrentLegalTerms).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  // Staff invitation flow audit, follow-up (this date): profile completeness is now enforced the
  // same way legal consent already was, checked AFTER consent (matching
  // resolveCustomerOnboardingGate()'s own established consent-before-profile ordering).
  describe('profile-completion gate (staff invitation flow audit, follow-up)', () => {
    it('redirects an authenticated, consented caller with an incomplete profile to /complete-account, carrying the invitation URL as next', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
      mockHasAcceptedCurrentLegalTerms.mockResolvedValue(true);
      mockIsProfileComplete.mockResolvedValue(false);

      await expect(renderAcceptPage('tok-123')).rejects.toThrow(
        'REDIRECT:/complete-account?next=%2Finvitations%2Faccept%3Ftoken%3Dtok-123',
      );
    });

    it('checks legal consent BEFORE profile completeness -- an incomplete-both caller lands on /legal-consent, not /complete-account', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
      mockHasAcceptedCurrentLegalTerms.mockResolvedValue(false);
      mockIsProfileComplete.mockResolvedValue(false);

      await expect(renderAcceptPage('tok-123')).rejects.toThrow(
        'REDIRECT:/legal-consent?next=%2Finvitations%2Faccept%3Ftoken%3Dtok-123',
      );
      expect(mockIsProfileComplete).not.toHaveBeenCalled();
    });

    it('never checks profile completeness for an unauthenticated caller -- they get the sign-in prompt instead', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const element = await renderAcceptPage('tok-123');
      render(element);
      expect(mockIsProfileComplete).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('an existing user whose profile is already complete is never redirected to /complete-account (no forced re-completion)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'existing-user' } } });
      mockHasAcceptedCurrentLegalTerms.mockResolvedValue(true);
      mockIsProfileComplete.mockResolvedValue(true);

      const element = await renderAcceptPage('tok-456');
      const { getByTestId } = render(element);
      expect(getByTestId('accept-invite-client').textContent).toBe('tok-456');
      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });
});
