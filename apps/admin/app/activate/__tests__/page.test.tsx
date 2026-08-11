import { describe, expect, it, vi, beforeEach } from 'vitest';
import { hasAcceptedCurrentLegalTerms } from '@/lib/legalConsent';
import { isProfileComplete } from '@/lib/profileCompletion';
import ActivatePage from '../page';
import { ActivateClient } from '../ActivateClient';

// Tenant onboarding completion pass (WORKLOG.md this date), "IMPORTANT INVITATION ORDER": pins
// that an authenticated caller is gated on consent, then profile completion, BEFORE ever reaching
// ActivateClient (which is what actually calls accept_tenant_invitation()) -- closing the audit's
// gap where a genuinely incomplete account could be linked to a tenant record. A signed-out
// visitor is completely unaffected (ActivateClient's own signed-out branch still handles that).

const getUser = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabaseClient: async () => ({ auth: { getUser } }),
}));
vi.mock('@/lib/legalConsent', () => ({ hasAcceptedCurrentLegalTerms: vi.fn() }));
vi.mock('@/lib/profileCompletion', () => ({ isProfileComplete: vi.fn() }));
vi.mock('../ActivateClient', () => ({ ActivateClient: () => null }));

const mockHasAcceptedCurrentLegalTerms = vi.mocked(hasAcceptedCurrentLegalTerms);
const mockIsProfileComplete = vi.mocked(isProfileComplete);

beforeEach(() => {
  vi.clearAllMocks();
  mockHasAcceptedCurrentLegalTerms.mockResolvedValue(true);
  mockIsProfileComplete.mockResolvedValue(true);
});

describe('ActivatePage', () => {
  it('renders ActivateClient without checking consent/profile for a signed-out visitor', async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const result = await ActivatePage({ searchParams: Promise.resolve({ token: 'abc' }) });

    expect((result as { type: unknown }).type).toBe(ActivateClient);
    expect(mockHasAcceptedCurrentLegalTerms).not.toHaveBeenCalled();
    expect(mockIsProfileComplete).not.toHaveBeenCalled();
  });

  it('redirects an authenticated caller with incomplete profile to /complete-account, preserving the activation token as next', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockIsProfileComplete.mockResolvedValue(false);

    await expect(ActivatePage({ searchParams: Promise.resolve({ token: 'abc' }) })).rejects.toThrow(
      'REDIRECT:/complete-account?next=%2Factivate%3Ftoken%3Dabc',
    );
  });

  it('redirects an authenticated caller with missing consent to /legal-consent, checked BEFORE profile completion', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockHasAcceptedCurrentLegalTerms.mockResolvedValue(false);

    await expect(ActivatePage({ searchParams: Promise.resolve({ token: 'abc' }) })).rejects.toThrow(
      'REDIRECT:/legal-consent?next=%2Factivate%3Ftoken%3Dabc',
    );
    expect(mockIsProfileComplete).not.toHaveBeenCalled();
  });

  it('renders ActivateClient without redirecting once consent and profile are both already complete', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    const result = await ActivatePage({ searchParams: Promise.resolve({ token: 'abc' }) });

    expect((result as { type: unknown }).type).toBe(ActivateClient);
  });

  it('preserves the plain /activate path (no token) as next when the caller used manual code entry', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockIsProfileComplete.mockResolvedValue(false);

    await expect(ActivatePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'REDIRECT:/complete-account?next=%2Factivate',
    );
  });
});
