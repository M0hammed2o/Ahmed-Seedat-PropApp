import { describe, expect, it, afterEach, vi } from 'vitest';
import { resolveTrustedClientIp } from '../clientIp';

// Stage 4 client-IP spoofing fix (WORKLOG.md this date). Pins the exact decision table
// resolveTrustedClientIp() must produce -- the real vulnerability was that every IP-keyed rate
// limit trusted the first X-Forwarded-For entry unconditionally, letting one attacker bypass the
// limit entirely by sending a different value per request (proven in
// e2e/client-ip-security.spec.ts against the real routes).

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request('http://localhost/test', { headers });
}

// NODE_ENV is typed read-only by @types/node -- vi.stubEnv is Vitest's own sanctioned way to
// override it per-test, restored automatically by unstubAllEnvs below.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveTrustedClientIp', () => {
  it('an ordinary trusted production request (real Cloudflare header) resolves correctly', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const request = requestWithHeaders({ 'cf-connecting-ip': '203.0.113.42' });
    expect(resolveTrustedClientIp(request)).toBe('203.0.113.42');
  });

  it('in production, an attacker-supplied X-Forwarded-For cannot change identity even when CF-Connecting-IP is also present', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const request = requestWithHeaders({
      'cf-connecting-ip': '203.0.113.42',
      'x-forwarded-for': '6.6.6.6', // attacker-chosen, must be ignored
    });
    expect(resolveTrustedClientIp(request)).toBe('203.0.113.42');
  });

  it('in production, a spoofed X-Forwarded-For with no CF-Connecting-IP never becomes the resolved identity', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const first = resolveTrustedClientIp(requestWithHeaders({ 'x-forwarded-for': '1.1.1.1' }));
    const second = resolveTrustedClientIp(requestWithHeaders({ 'x-forwarded-for': '2.2.2.2' }));
    // Both attacker-chosen values are rejected -- both requests collapse to the same shared
    // fallback identity rather than the attacker's own per-request choice.
    expect(first).toBe('unverified-origin');
    expect(second).toBe('unverified-origin');
    expect(first).toBe(second);
  });

  it('malformed CF-Connecting-IP values are rejected, not trusted verbatim', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const request = requestWithHeaders({ 'cf-connecting-ip': 'not-an-ip; DROP TABLE users' });
    expect(resolveTrustedClientIp(request)).toBe('unverified-origin');
  });

  it('malformed X-Forwarded-For values are rejected in development too', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const request = requestWithHeaders({ 'x-forwarded-for': 'garbage-not-an-ip' });
    expect(resolveTrustedClientIp(request)).toBe('unverified-origin');
  });

  it('a valid IPv4 CF-Connecting-IP works', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const request = requestWithHeaders({ 'cf-connecting-ip': '198.51.100.7' });
    expect(resolveTrustedClientIp(request)).toBe('198.51.100.7');
  });

  it('a valid IPv6 CF-Connecting-IP works, bracketed or not', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveTrustedClientIp(requestWithHeaders({ 'cf-connecting-ip': '2001:db8::1' }))).toBe(
      '2001:db8::1',
    );
    expect(
      resolveTrustedClientIp(requestWithHeaders({ 'cf-connecting-ip': '[2001:db8::1]' })),
    ).toBe('2001:db8::1');
  });

  it('a proxy-chained X-Forwarded-For in development takes the first (client) entry', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const request = requestWithHeaders({
      'x-forwarded-for': '203.0.113.9, 10.0.0.5, 10.0.0.1',
    });
    expect(resolveTrustedClientIp(request)).toBe('203.0.113.9');
  });

  it('a malformed first entry in a proxy chain is rejected even in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const request = requestWithHeaders({ 'x-forwarded-for': 'not-an-ip, 203.0.113.9' });
    expect(resolveTrustedClientIp(request)).toBe('unverified-origin');
  });

  it('local development (no Cloudflare header) still resolves via X-Forwarded-For', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const request = requestWithHeaders({ 'x-forwarded-for': '192.0.2.55' });
    expect(resolveTrustedClientIp(request)).toBe('192.0.2.55');
  });

  it('local development falls back to X-Real-IP when X-Forwarded-For is absent', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const request = requestWithHeaders({ 'x-real-ip': '192.0.2.77' });
    expect(resolveTrustedClientIp(request)).toBe('192.0.2.77');
  });

  it('with no trustworthy signal at all, falls back to a fixed shared identity rather than throwing or returning empty', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const request = requestWithHeaders({});
    expect(resolveTrustedClientIp(request)).toBe('unverified-origin');
  });

  it('the RFC 7239 Forwarded header is never read, in production or development', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveTrustedClientIp(requestWithHeaders({ forwarded: 'for=6.6.6.6' }))).toBe(
      'unverified-origin',
    );

    vi.stubEnv('NODE_ENV', 'development');
    expect(resolveTrustedClientIp(requestWithHeaders({ forwarded: 'for=6.6.6.6' }))).toBe(
      'unverified-origin',
    );
  });
});
