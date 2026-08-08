import { test, expect } from '@playwright/test';
import { BASE_URL } from '../playwright.config';

// Stage 2/3/4 (WORKLOG.md this date) -- permanent regression coverage for a real, proven
// client-IP spoofing bypass: resolveTrustedClientIp() (lib/clientIp.ts) trusting the first
// X-Forwarded-For entry unconditionally let a single attacker defeat every IP-keyed rate limit
// (signin, signup, password-reset) simply by sending a different value per request. Real HTTP
// requests against the real routes only -- no inference from anything else.
//
// This suite runs against the local dev server, same as every other spec in this project
// (NODE_ENV=development, no Cloudflare in front) -- resolveTrustedClientIp() deliberately keeps
// honoring X-Forwarded-For/X-Real-IP OUTSIDE production specifically so this kind of per-test IP
// isolation (and auth-security.spec.ts's own synthetic-IP technique) keeps working without a real
// proxy in front to supply CF-Connecting-IP. That means the dev-mode tests below intentionally
// still show a bypass -- that is NOT the vulnerability (see the "dev-mode exception is
// intentional" tests), it is documented, disclosed, deliberate behavior for local testability.
// The actual production-mode fix (CF-Connecting-IP trusted, X-Forwarded-For never authoritative)
// is proven deterministically in lib/__tests__/clientIp.test.ts, which directly controls
// NODE_ENV and cannot be exercised through this dev-only server -- and was additionally verified
// once manually against a real production-mode build pointed at local Supabase (WORKLOG.md this
// date), since standing up a second permanent production webServer for every Playwright run would
// meaningfully slow down this whole suite for a claim the unit tests already prove rigorously.

function randomIp(): string {
  return `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
}

test.describe('client-IP / rate-limit spoofing', () => {
  test('password-reset: a fixed IP is rate-limited normally', async ({ request }) => {
    const fixedIp = randomIp();
    let sawRateLimit = false;
    for (let i = 0; i < 6; i++) {
      const response = await request.post('/api/v1/auth/password-reset', {
        headers: { Origin: BASE_URL, 'X-Forwarded-For': fixedIp },
        data: { email: `baseline-${i}@example.com` },
      });
      if (response.status() === 429) {
        sawRateLimit = true;
        break;
      }
      expect(response.status()).toBe(200); // passwordResetAttemptsPerMinute = 5, not yet limited
    }
    expect(sawRateLimit).toBe(true);
  });

  test('dev-mode exception is intentional, not a regression: rotating X-Forwarded-For still bypasses the LOCAL DEV server (no Cloudflare in front to supply CF-Connecting-IP)', async ({
    request,
  }) => {
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++) {
      const response = await request.post('/api/v1/auth/password-reset', {
        headers: { Origin: BASE_URL, 'X-Forwarded-For': randomIp() },
        data: { email: `spoof-${i}@example.com` },
      });
      statuses.push(response.status());
    }
    // Documents the deliberate, disclosed dev-only exception -- see the file-level comment.
    // lib/__tests__/clientIp.test.ts proves the production branch this local server never
    // exercises (NODE_ENV=production, CF-Connecting-IP required) actually closes this.
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});
