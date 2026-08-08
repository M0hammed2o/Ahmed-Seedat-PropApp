import { test, expect } from '@playwright/test';
import { PROD_BASE_URL } from '../playwright.prod-security.config';

// Stage 4/5 client-IP spoofing fix (WORKLOG.md this date) -- runs only against a real production
// build (`playwright.prod-security.config.ts`, NODE_ENV=production via `next start`), the one
// environment where resolveTrustedClientIp() (lib/clientIp.ts) actually takes its
// CF-Connecting-IP-trusted / X-Forwarded-For-ignored branch. Re-runs the exact attack proven live
// in e2e/client-ip-security.spec.ts (rotating X-Forwarded-For per request) against this build and
// confirms it no longer bypasses the limit -- the direct, real-route proof that the vulnerability
// found in Stage 3 is closed in the mode that matters (production), not just in the unit tests.
//
// Also covers the two other headers a caller could try instead of X-Forwarded-For: X-Real-IP
// (resolveTrustedClientIp only reads it outside production, same as X-Forwarded-For) and the
// RFC 7239 `Forwarded` header (never read by resolveTrustedClientIp at all, in any environment --
// confirmed by grep before writing these tests: no file under apps/admin reads it). Both are
// proven here to have zero effect on the bucket key in production, same as X-Forwarded-For.

function randomIp(): string {
  return `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
}

test.describe('client-IP spoofing fix (production mode)', () => {
  test('password-reset: rotating X-Forwarded-For no longer bypasses the limit', async ({
    request,
  }) => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const response = await request.post('/api/v1/auth/password-reset', {
        headers: { Origin: PROD_BASE_URL, 'X-Forwarded-For': randomIp() },
        data: { email: `prod-spoof-${i}@example.com` },
      });
      statuses.push(response.status());
      if (response.status() === 429) break;
    }
    console.warn('=== [prod] password-reset rotating-XFF statuses ===', statuses);
    expect(statuses).toContain(429); // passwordResetAttemptsPerMinute = 5 -- now enforced regardless of XFF
  });

  test('signup: rotating X-Forwarded-For no longer bypasses the limit', async ({ request }) => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const response = await request.post('/api/v1/auth/signup', {
        headers: { Origin: PROD_BASE_URL, 'X-Forwarded-For': randomIp() },
        data: {
          email: `prod-spoof-signup-${Date.now()}-${i}@example.com`,
          password: 'correct horse battery staple',
          confirmPassword: 'correct horse battery staple',
          acceptedTermsVersion: '1',
          acceptedPrivacyVersion: '1',
          next: '/dashboard',
        },
      });
      statuses.push(response.status());
      if (response.status() === 429) break;
    }
    console.warn('=== [prod] signup rotating-XFF statuses ===', statuses);
    expect(statuses).toContain(429); // signupAttemptsPerMinute = 5
  });

  test('signin: rotating X-Forwarded-For no longer bypasses the IP bucket (email varied too, to isolate it)', async ({
    request,
  }) => {
    const statuses: number[] = [];
    for (let i = 0; i < 13; i++) {
      const response = await request.post('/api/v1/auth/signin', {
        headers: { Origin: PROD_BASE_URL, 'X-Forwarded-For': randomIp() },
        data: { email: `prod-spoof-signin-${i}@example.com`, password: 'definitely-wrong' },
      });
      statuses.push(response.status());
      if (response.status() === 429) break;
    }
    console.warn('=== [prod] signin rotating-XFF statuses ===', statuses);
    expect(statuses).toContain(429); // loginAttemptsPerMinute = 10
  });

  test('password-reset: rotating X-Real-IP no longer bypasses the limit', async ({ request }) => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const response = await request.post('/api/v1/auth/password-reset', {
        headers: { Origin: PROD_BASE_URL, 'X-Real-IP': randomIp() },
        data: { email: `prod-spoof-realip-${i}@example.com` },
      });
      statuses.push(response.status());
      if (response.status() === 429) break;
    }
    console.warn('=== [prod] password-reset rotating-X-Real-IP statuses ===', statuses);
    expect(statuses).toContain(429);
  });

  test('password-reset: rotating the RFC 7239 Forwarded header no longer bypasses the limit', async ({
    request,
  }) => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const response = await request.post('/api/v1/auth/password-reset', {
        headers: { Origin: PROD_BASE_URL, Forwarded: `for=${randomIp()}` },
        data: { email: `prod-spoof-forwarded-${i}@example.com` },
      });
      statuses.push(response.status());
      if (response.status() === 429) break;
    }
    console.warn('=== [prod] password-reset rotating-Forwarded statuses ===', statuses);
    expect(statuses).toContain(429);
  });

  test('control: a consistent, trustworthy identity (CF-Connecting-IP) still gets rate-limited normally', async ({
    request,
  }) => {
    // No real Cloudflare edge sits in front of this local production build, so nothing stops this
    // test itself from setting CF-Connecting-IP -- that is expected and fine here: the point of
    // this test is only to prove the mechanism behaves correctly given a CONSISTENT identity
    // (what a real visitor through real Cloudflare would produce), not to simulate an attacker.
    const fixedIp = randomIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const response = await request.post('/api/v1/auth/password-reset', {
        headers: { Origin: PROD_BASE_URL, 'CF-Connecting-IP': fixedIp },
        data: { email: `prod-control-${i}@example.com` },
      });
      statuses.push(response.status());
      if (response.status() === 429) break;
    }
    console.warn('=== [prod] control fixed-CF-Connecting-IP statuses ===', statuses);
    expect(statuses).toContain(429);
  });
});
