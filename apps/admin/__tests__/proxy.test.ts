import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { isTrustedOrigin } from '../proxy';

// Regression coverage for a real bug this function had, caught live by the Playwright suite
// (Stage 7, commercial-launch execution plan, WORKLOG.md 2026-08-06): comparing an incoming
// Origin header against `request.nextUrl.origin` silently rejected every genuinely same-origin
// request whenever the app was reached via a literal IP (e.g. 127.0.0.1) rather than the string
// "localhost" -- Next.js canonicalizes `nextUrl.origin` regardless of the real Host header. Fixed
// to compare against the request's own Host header instead; these tests pin that fix.

function mutatingRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { method: 'POST', headers });
}

describe('isTrustedOrigin', () => {
  it('trusts a same-origin request reached via 127.0.0.1 (the exact case that regressed)', () => {
    const req = mutatingRequest('http://127.0.0.1:3100/api/v1/organizations', {
      origin: 'http://127.0.0.1:3100',
      host: '127.0.0.1:3100',
    });
    expect(isTrustedOrigin(req)).toBe(true);
  });

  it('trusts a same-origin request reached via localhost', () => {
    const req = mutatingRequest('http://localhost:3100/api/v1/organizations', {
      origin: 'http://localhost:3100',
      host: 'localhost:3100',
    });
    expect(isTrustedOrigin(req)).toBe(true);
  });

  it('rejects a forged cross-origin request', () => {
    const req = mutatingRequest('http://127.0.0.1:3100/api/v1/organizations', {
      origin: 'https://evil.example',
      host: '127.0.0.1:3100',
    });
    expect(isTrustedOrigin(req)).toBe(false);
  });

  it('rejects a mutating request with neither Origin nor Referer (fails closed)', () => {
    const req = mutatingRequest('http://127.0.0.1:3100/api/v1/organizations', {
      host: '127.0.0.1:3100',
    });
    expect(isTrustedOrigin(req)).toBe(false);
  });

  it('falls back to a matching Referer when Origin is absent', () => {
    const req = mutatingRequest('http://127.0.0.1:3100/api/v1/organizations', {
      host: '127.0.0.1:3100',
      referer: 'http://127.0.0.1:3100/properties/new',
    });
    expect(isTrustedOrigin(req)).toBe(true);
  });

  it('rejects a mismatched Referer', () => {
    const req = mutatingRequest('http://127.0.0.1:3100/api/v1/organizations', {
      host: '127.0.0.1:3100',
      referer: 'https://evil.example/attack',
    });
    expect(isTrustedOrigin(req)).toBe(false);
  });

  it('never blocks a non-mutating (GET) request, even cross-origin', () => {
    const req = new NextRequest('http://127.0.0.1:3100/manifest.webmanifest', {
      method: 'GET',
      headers: { origin: 'https://evil.example', host: '127.0.0.1:3100' },
    });
    expect(isTrustedOrigin(req)).toBe(true);
  });

  it('exempts the PayFast billing webhook regardless of origin (signature-authenticated, not cookie-authenticated)', () => {
    const req = mutatingRequest('http://127.0.0.1:3100/api/v1/billing/webhook', {
      host: '127.0.0.1:3100',
      // Deliberately no origin/referer at all -- exactly how PayFast's real ITN callback arrives.
    });
    expect(isTrustedOrigin(req)).toBe(true);
  });

  it('exempts any request carrying an Authorization: Bearer header, regardless of origin', () => {
    const req = mutatingRequest('http://127.0.0.1:3100/api/v1/system/generate-rent-schedules', {
      host: '127.0.0.1:3100',
      origin: 'https://evil.example',
      authorization: 'Bearer some-cron-job-secret-or-supabase-jwt',
    });
    expect(isTrustedOrigin(req)).toBe(true);
  });
});
