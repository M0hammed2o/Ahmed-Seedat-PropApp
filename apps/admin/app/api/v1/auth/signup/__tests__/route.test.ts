import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Entry-path preservation audit (this date): the marketing site's plan-specific CTA
// (PricingSection.tsx) sets ?next=/onboarding/choose-plan?plan=...&interval=... on /register,
// which RegisterForm.tsx forwards into this route's own `next` field unchanged. This route is the
// ONE place that value gets baked into `emailRedirectTo` -- the confirmation email's actual link --
// so it survives async email confirmation independent of browser/session state. Mocked (not the
// real-local-Supabase-integration pattern used elsewhere in this codebase) because what's being
// verified here is the exact call this route makes to signUp(), not GoTrue's own behavior.

const mockSignUp = vi.fn();
const mockRecordLegalConsent = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabaseClient: async () => ({ auth: { signUp: mockSignUp } }),
  getServiceRoleClient: () => ({}),
}));
vi.mock('@/lib/rateLimit', () => ({ rateLimitOrRespond: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/clientIp', () => ({ resolveTrustedClientIp: () => '203.0.113.5' }));
vi.mock('@/lib/appUrl', () => ({ getRequestOrigin: () => 'https://proplyst.co.za' }));
vi.mock('@/lib/legalConsent', () => ({ recordLegalConsent: mockRecordLegalConsent }));

const { POST: signup } = await import('../route');

function postRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validSignupBody = {
  email: 'new-customer@example.com',
  password: 'a-real-password-1',
  confirmPassword: 'a-real-password-1',
  acceptedTermsVersion: '2026-08-01',
  acceptedPrivacyVersion: '2026-08-01',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/v1/auth/signup -- next=/emailRedirectTo wiring', () => {
  it('bakes a plan-bearing next (plan + interval) into emailRedirectTo unchanged', async () => {
    mockSignUp.mockResolvedValue({ data: { user: { id: 'u-1' }, session: null }, error: null });

    const nextValue = '/onboarding/choose-plan?plan=professional&interval=annual';
    const response = await signup(postRequest({ ...validSignupBody, next: nextValue }));

    expect(response.status).toBe(200);
    expect(mockSignUp).toHaveBeenCalledTimes(1);
    const call = mockSignUp.mock.calls[0]![0];
    expect(call.options.emailRedirectTo).toBe(
      `https://proplyst.co.za/auth/callback?next=${encodeURIComponent(nextValue)}`,
    );
  });

  it('defaults to next=/ when the caller sends no plan context (generic signup)', async () => {
    mockSignUp.mockResolvedValue({ data: { user: { id: 'u-2' }, session: null }, error: null });

    const response = await signup(postRequest({ ...validSignupBody, next: '/' }));

    expect(response.status).toBe(200);
    const call = mockSignUp.mock.calls[0]![0];
    expect(call.options.emailRedirectTo).toBe('https://proplyst.co.za/auth/callback?next=%2F');
  });

  it('rejects an absolute-URL next before ever calling signUp() -- open-redirect protection', async () => {
    const response = await signup(
      postRequest({ ...validSignupBody, next: 'https://evil.example/steal' }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('validation_failed');
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('rejects a protocol-relative //next before ever calling signUp()', async () => {
    const response = await signup(postRequest({ ...validSignupBody, next: '//evil.example' }));

    expect(response.status).toBe(400);
    expect(mockSignUp).not.toHaveBeenCalled();
  });
});
