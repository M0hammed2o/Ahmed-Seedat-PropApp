import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bearerTokenMfaStatus, requireCustomerMfaIfEnrolled } from '../mfaGate';

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

// Mobile channel (2026-09-14): the bearer-token counterpart. A bearer client holds no stored
// session, so the question must be asked about the token itself -- and an unreachable Supabase
// Auth must never be read as "no MFA".
describe('bearerTokenMfaStatus', () => {
  function clientReturning(result: unknown) {
    const getAal = vi.fn().mockResolvedValue(result);
    return {
      client: {
        auth: { mfa: { getAuthenticatorAssuranceLevel: getAal } },
      } as unknown as SupabaseClient,
      getAal,
    };
  }

  it('asks about the bearer token itself, not a stored session', async () => {
    const { client, getAal } = clientReturning({
      data: { currentLevel: 'aal1', nextLevel: 'aal1' },
      error: null,
    });
    await bearerTokenMfaStatus(client, 'token-abc');
    expect(getAal).toHaveBeenCalledWith('token-abc');
  });

  it('no verified factor -> satisfied', async () => {
    const { client } = clientReturning({
      data: { currentLevel: 'aal1', nextLevel: 'aal1' },
      error: null,
    });
    expect(await bearerTokenMfaStatus(client, 't')).toBe('satisfied');
  });

  it('verified factor, token still AAL1 -> step_up_required', async () => {
    const { client } = clientReturning({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    });
    expect(await bearerTokenMfaStatus(client, 't')).toBe('step_up_required');
  });

  it('verified factor, token already AAL2 -> satisfied', async () => {
    const { client } = clientReturning({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    });
    expect(await bearerTokenMfaStatus(client, 't')).toBe('satisfied');
  });

  it('a token Supabase Auth rejects (4xx) -> invalid_token, left to the route to answer 401', async () => {
    const { client } = clientReturning({
      data: null,
      error: { status: 403, message: 'invalid JWT' },
    });
    expect(await bearerTokenMfaStatus(client, 't')).toBe('invalid_token');
  });

  it('Supabase Auth unreachable or failing (no status, 5xx) -> unverifiable, never "no MFA"', async () => {
    for (const error of [
      { message: 'fetch failed' },
      { status: 0, message: 'network' },
      { status: 503, message: 'down' },
    ]) {
      const { client } = clientReturning({ data: null, error });
      expect(await bearerTokenMfaStatus(client, 't'), JSON.stringify(error)).toBe('unverifiable');
    }
  });
});
