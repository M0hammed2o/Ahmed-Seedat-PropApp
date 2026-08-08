import { describe, expect, it, vi, beforeEach } from 'vitest';
import { requireCustomerMfaIfEnrolled } from '../mfaGate';

// Stage 3 customer MFA bypass fix (WORKLOG.md this date). Pins the exact decision table
// requireCustomerMfaIfEnrolled() must produce -- the real vulnerability was that NOTHING in the
// customer path ever asked this question at all, so these cases matter individually, not just
// the "happy path".

const mockGetAal = vi.fn();
vi.mock('../supabase/server', () => ({
  getServerSupabaseClient: () => ({
    auth: { mfa: { getAuthenticatorAssuranceLevel: mockGetAal } },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireCustomerMfaIfEnrolled', () => {
  it('returns false for a user with no MFA factor enrolled at all', async () => {
    mockGetAal.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal1' },
      error: null,
    });
    expect(await requireCustomerMfaIfEnrolled()).toBe(false);
  });

  it('returns true for an enrolled user sitting at AAL1 (password verified, code not yet entered)', async () => {
    mockGetAal.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    });
    expect(await requireCustomerMfaIfEnrolled()).toBe(true);
  });

  it('returns false once the session has completed the step-up to AAL2', async () => {
    mockGetAal.mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    });
    expect(await requireCustomerMfaIfEnrolled()).toBe(false);
  });

  it('returns false when there is no session at all (no aal data)', async () => {
    mockGetAal.mockResolvedValue({ data: null, error: null });
    expect(await requireCustomerMfaIfEnrolled()).toBe(false);
  });

  it('uses an explicitly-supplied client instead of constructing its own -- the proxy.ts (middleware) call path', async () => {
    const explicitGetAal = vi.fn().mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    });
    const explicitClient = {
      auth: { mfa: { getAuthenticatorAssuranceLevel: explicitGetAal } },
    } as any;

    expect(await requireCustomerMfaIfEnrolled(explicitClient)).toBe(true);
    expect(explicitGetAal).toHaveBeenCalledTimes(1);
    expect(mockGetAal).not.toHaveBeenCalled(); // never fell back to constructing its own client
  });
});
