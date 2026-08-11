import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolvePortalSession } from '@/lib/orgSession';
import { requireCustomerMfaIfEnrolled } from '@/lib/mfaGate';
import { hasAcceptedCurrentLegalTerms } from '@/lib/legalConsent';
import { isProfileComplete } from '@/lib/profileCompletion';
import DashboardLayout from '../layout';

// Tenant onboarding completion pass (WORKLOG.md this date), Phase 12 "direct route security":
// the audit found this redirect gate was verified only by reading the code, never by an
// automated test proving a tenant-only identity (zero org memberships) is actually turned away
// from the staff dashboard when it navigates here directly (not via any nav link, which a tenant
// UI never even renders). resolvePortalSession() is org-staff's own independent identity
// resolver -- a tenant-only account still gets a non-null session back from it (an authenticated
// caller with organizations: []), so the real enforcement is the activeOrg check below, not a
// null-session check; this pins that specific branch.

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }));
vi.mock('@/lib/orgSession', () => ({ resolvePortalSession: vi.fn() }));
vi.mock('@/lib/mfaGate', () => ({ requireCustomerMfaIfEnrolled: vi.fn() }));
vi.mock('@/lib/legalConsent', () => ({ hasAcceptedCurrentLegalTerms: vi.fn() }));
vi.mock('@/lib/profileCompletion', () => ({ isProfileComplete: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getServerSupabaseClient: async () => ({}) }));

const mockResolvePortalSession = vi.mocked(resolvePortalSession);
const mockRequireCustomerMfaIfEnrolled = vi.mocked(requireCustomerMfaIfEnrolled);
const mockHasAcceptedCurrentLegalTerms = vi.mocked(hasAcceptedCurrentLegalTerms);
const mockIsProfileComplete = vi.mocked(isProfileComplete);

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireCustomerMfaIfEnrolled.mockResolvedValue(false);
  mockHasAcceptedCurrentLegalTerms.mockResolvedValue(true);
  mockIsProfileComplete.mockResolvedValue(true);
});

describe('(dashboard) layout', () => {
  it('never renders the staff dashboard for a tenant-only identity (zero org memberships) -- redirects to onboarding instead', async () => {
    mockResolvePortalSession.mockResolvedValue({
      userId: 'tenant-user-1',
      organizations: [],
      ownerIdentities: [],
      isPlatformAdmin: false,
      supportSessions: [],
    });

    await expect(DashboardLayout({ children: null })).rejects.toThrow(
      'REDIRECT:/onboarding/create-organization',
    );
  });

  it('redirects to /login for a genuinely unauthenticated caller', async () => {
    mockResolvePortalSession.mockResolvedValue(null);

    await expect(DashboardLayout({ children: null })).rejects.toThrow('REDIRECT:/login');
  });
});
