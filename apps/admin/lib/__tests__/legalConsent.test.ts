import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getLegalConsentStatus,
  hasAcceptedCurrentLegalTerms,
  recordLegalConsent,
} from '../legalConsent';

// Production signup/onboarding (WORKLOG.md this date). Pins the exact decision table these
// functions must produce -- the real gap was that the consent checkboxes were validated and then
// discarded; these tests exist so a future change can't silently reintroduce that.

const mockGetUser = vi.fn();
const mockSelect = vi.fn();
const mockUpsert = vi.fn();

vi.mock('../supabase/server', () => ({
  getServerSupabaseClient: () => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({ in: mockSelect }),
      }),
      upsert: mockUpsert,
    }),
  }),
  getServiceRoleClient: () => ({
    from: () => ({ upsert: mockUpsert }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getLegalConsentStatus / hasAcceptedCurrentLegalTerms', () => {
  it('returns false for both when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const status = await getLegalConsentStatus();
    expect(status).toEqual({ termsAccepted: false, privacyAccepted: false });
    expect(await hasAcceptedCurrentLegalTerms()).toBe(false);
  });

  it('returns false when no acceptance rows exist at all', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockSelect.mockResolvedValue({ data: [] });
    expect(await hasAcceptedCurrentLegalTerms()).toBe(false);
  });

  it('returns false when a row exists but at a stale/older version', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockSelect.mockResolvedValue({
      data: [{ document_type: 'terms_of_service', version: 'v0-stale' }],
    });
    expect(await hasAcceptedCurrentLegalTerms()).toBe(false);
  });

  it('returns true only once BOTH terms and privacy are accepted at the current version', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    // Only terms accepted -- still incomplete.
    mockSelect.mockResolvedValueOnce({
      data: [{ document_type: 'terms_of_service', version: 'v1-placeholder-2026-08-03' }],
    });
    expect(await hasAcceptedCurrentLegalTerms()).toBe(false);

    // Both accepted at the current version -- complete.
    mockSelect.mockResolvedValueOnce({
      data: [
        { document_type: 'terms_of_service', version: 'v1-placeholder-2026-08-03' },
        { document_type: 'privacy_policy', version: 'v1-placeholder-2026-08-03' },
      ],
    });
    expect(await hasAcceptedCurrentLegalTerms()).toBe(true);
  });
});

describe('recordLegalConsent', () => {
  it('writes both documents at the server-configured version, using the service-role client', async () => {
    mockUpsert.mockResolvedValue({ error: null });
    await recordLegalConsent('u1');

    expect(mockUpsert).toHaveBeenCalledWith(
      [
        { user_id: 'u1', document_type: 'terms_of_service', version: 'v1-placeholder-2026-08-03' },
        { user_id: 'u1', document_type: 'privacy_policy', version: 'v1-placeholder-2026-08-03' },
      ],
      { onConflict: 'user_id,document_type,version', ignoreDuplicates: true },
    );
  });

  it('never throws when the write fails -- consent recording must not block signup', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'db unavailable' } });
    await expect(recordLegalConsent('u1')).resolves.toBeUndefined();
  });
});
