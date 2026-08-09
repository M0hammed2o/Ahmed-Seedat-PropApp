import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isProfileComplete } from '../profileCompletion';

const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock('../supabase/server', () => ({
  getServerSupabaseClient: () => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mockMaybeSingle }),
      }),
    }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isProfileComplete', () => {
  it('returns false when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect(await isProfileComplete()).toBe(false);
  });

  it('returns false when profile_completed_at has never been set', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockMaybeSingle.mockResolvedValue({ data: { profile_completed_at: null } });
    expect(await isProfileComplete()).toBe(false);
  });

  it('returns false when there is no profile row at all', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockMaybeSingle.mockResolvedValue({ data: null });
    expect(await isProfileComplete()).toBe(false);
  });

  it('returns true once profile_completed_at is set, regardless of other fields', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockMaybeSingle.mockResolvedValue({
      data: { profile_completed_at: '2026-08-08T00:00:00Z' },
    });
    expect(await isProfileComplete()).toBe(true);
  });
});
