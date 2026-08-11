import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveOwnerSession } from '@/lib/ownerSession';
import { requireCustomerMfaIfEnrolled } from '@/lib/mfaGate';
import OwnerPortalLayout from '../layout';

// Tenant onboarding completion pass (WORKLOG.md this date), Phase 12 "direct route security":
// a tenant-only identity has no `owners` row at all, so resolveOwnerSession() -- an entirely
// independent identity resolver from the tenant system -- returns null for it, same as any
// caller with no owner identity. Pins that a tenant navigating directly to /owner-portal never
// sees owner-portal content, redirected away before AppShell/owner data ever renders.

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }));
vi.mock('@/lib/ownerSession', () => ({ resolveOwnerSession: vi.fn() }));
vi.mock('@/lib/mfaGate', () => ({ requireCustomerMfaIfEnrolled: vi.fn() }));

const mockResolveOwnerSession = vi.mocked(resolveOwnerSession);
const mockRequireCustomerMfaIfEnrolled = vi.mocked(requireCustomerMfaIfEnrolled);

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireCustomerMfaIfEnrolled.mockResolvedValue(false);
});

describe('(owner) layout', () => {
  it('never renders owner-portal content for a tenant-only identity -- redirects to /login instead', async () => {
    mockResolveOwnerSession.mockResolvedValue(null);

    await expect(OwnerPortalLayout({ children: null })).rejects.toThrow('REDIRECT:/login');
  });
});
