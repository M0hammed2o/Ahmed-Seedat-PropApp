import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { getAppUrl, getRequestOrigin } from '../appUrl';

// Fix for the real, live-confirmed production bug (WORKLOG.md this date): `new
// URL(request.url).origin` inside a Route Handler resolves to Render's internal
// `https://localhost:10000`, not the public `https://proplyst.co.za`, because Route Handlers see
// the raw request as the reverse proxy forwards it internally -- confirmed via direct `curl`
// against the live callback route before this fix. getRequestOrigin() must never derive the
// origin from request.url; these tests pin that it only ever uses forwarded headers or the
// configured NEXT_PUBLIC_APP_URL.

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL;
});

afterEach(() => {
  if (ORIGINAL_APP_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
});

describe('getAppUrl', () => {
  it('falls back to localhost:3000 when unset', () => {
    expect(getAppUrl()).toBe('http://localhost:3000');
  });

  it('strips a trailing slash from a configured value', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://proplyst.co.za/';
    expect(getAppUrl()).toBe('https://proplyst.co.za');
  });
});

describe('getRequestOrigin', () => {
  it('uses X-Forwarded-Host + X-Forwarded-Proto when both are present -- the real Render/Cloudflare shape', () => {
    const headers = new Headers({
      'x-forwarded-host': 'proplyst.co.za',
      'x-forwarded-proto': 'https',
    });
    expect(getRequestOrigin(headers)).toBe('https://proplyst.co.za');
  });

  it('defaults the protocol to https when only X-Forwarded-Host is present', () => {
    const headers = new Headers({ 'x-forwarded-host': 'proplyst.co.za' });
    expect(getRequestOrigin(headers)).toBe('https://proplyst.co.za');
  });

  it('falls back to getAppUrl() when no forwarded headers are present -- ordinary local dev', () => {
    const headers = new Headers();
    expect(getRequestOrigin(headers)).toBe('http://localhost:3000');
  });

  it('falls back to the configured NEXT_PUBLIC_APP_URL when no forwarded headers are present', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://127.0.0.1:3100';
    const headers = new Headers();
    expect(getRequestOrigin(headers)).toBe('http://127.0.0.1:3100');
  });

  it('never derives the origin from a spoofable non-forwarded source -- forwarded host wins even if it looks unusual', () => {
    // Not a security check on this function's own input (the proxy chain is the trust boundary,
    // per this function's own comment) -- just pinning that the function's only two real inputs
    // are the forwarded headers and getAppUrl(), nothing else.
    const headers = new Headers({ 'x-forwarded-host': 'staging.proplyst.co.za' });
    expect(getRequestOrigin(headers)).toBe('https://staging.proplyst.co.za');
  });
});
