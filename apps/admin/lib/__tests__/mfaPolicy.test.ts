import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MOBILE_V1_API_ROUTES, isMobileV1ApiRoute, mfaRuleForApiRequest } from '../mfaPolicy';

// The V1 MFA posture (lib/mfaPolicy.ts), pinned as a decision table. The bug this closes: the
// customer step-up check only read the cookie session, so bearer-token requests skipped it by
// accident. Now the mobile exemption is explicit, exact, and limited to what the Android app calls.

const WEB_API_KT = fileURLToPath(
  new URL(
    '../../../android/app/src/main/java/za/co/proplyst/app/data/network/WebApi.kt',
    import.meta.url,
  ),
);

function androidEndpoints(): string[] {
  const source = readFileSync(WEB_API_KT, 'utf8');
  return [...source.matchAll(/@(GET|POST|PATCH|PUT|DELETE)\("(api\/v1\/[^"]+)"\)/g)]
    .map(([, method, path = '']) => `${method} /${path.replace(/\{[^}]+\}/g, '{id}')}`)
    .sort();
}

const concrete = (path: string) =>
  path.replace(/\{[^}]+\}/g, '0f1e2d3c-0000-4000-8000-000000000001');

describe('mobile V1 route list', () => {
  it('is exactly the set of endpoints apps/android WebApi.kt calls -- no more, no fewer', () => {
    const allowed = MOBILE_V1_API_ROUTES.map(
      (r) => `${r.method} ${r.path.replace(/\{[^}]+\}/g, '{id}')}`,
    ).sort();
    const android = [...new Set(androidEndpoints())];
    expect(android.length).toBeGreaterThan(20);
    expect(allowed).toEqual(android);
  });

  it('matches whole paths and exact methods only', () => {
    expect(isMobileV1ApiRoute('GET', concrete('/api/v1/invoices/{id}'))).toBe(true);
    expect(isMobileV1ApiRoute('get', concrete('/api/v1/invoices/{id}'))).toBe(true);
    expect(isMobileV1ApiRoute('PATCH', concrete('/api/v1/invoices/{id}'))).toBe(false);
    expect(isMobileV1ApiRoute('POST', concrete('/api/v1/invoices/{id}/void'))).toBe(false);
    expect(isMobileV1ApiRoute('GET', '/api/v1/invoices/a/b')).toBe(false);
    expect(isMobileV1ApiRoute('GET', '/api/v1/invoicesX')).toBe(false);
  });
});

describe('mfaRuleForApiRequest', () => {
  it('platform administration requires AAL2 at the route on every channel', () => {
    for (const channel of ['web_session', 'mobile_bearer'] as const) {
      for (const pathname of [
        '/api/v1/admin/organizations',
        concrete('/api/v1/admin/organizations/{id}/archive'),
      ]) {
        expect(mfaRuleForApiRequest({ channel, method: 'GET', pathname })).toBe(
          'route_enforces_aal2',
        );
        expect(mfaRuleForApiRequest({ channel, method: 'POST', pathname })).toBe(
          'route_enforces_aal2',
        );
      }
    }
  });

  it('sign-in and MFA endpoints manage their own assurance level', () => {
    for (const channel of ['web_session', 'mobile_bearer'] as const) {
      for (const pathname of [
        '/api/v1/auth/mfa/verify',
        '/api/v1/auth/mfa/unenroll',
        '/api/v1/auth/signin',
      ]) {
        expect(mfaRuleForApiRequest({ channel, method: 'POST', pathname })).toBe(
          'route_manages_own_aal',
        );
      }
    }
  });

  it('every Android V1 route needs no step-up on the mobile channel', () => {
    for (const { method, path } of MOBILE_V1_API_ROUTES) {
      expect(
        mfaRuleForApiRequest({ channel: 'mobile_bearer', method, pathname: concrete(path) }),
        `${method} ${path}`,
      ).toBe('mobile_v1_no_step_up');
    }
  });

  it('the same routes still require step-up for an enrolled web session (unchanged web behaviour)', () => {
    for (const { method, path } of MOBILE_V1_API_ROUTES) {
      expect(
        mfaRuleForApiRequest({ channel: 'web_session', method, pathname: concrete(path) }),
        `${method} ${path}`,
      ).toBe('step_up_if_enrolled');
    }
  });

  it('a bearer token on any route outside the Android surface requires step-up -- no accidental bypass', () => {
    const outside: [string, string][] = [
      ['PATCH', concrete('/api/v1/invoices/{id}')],
      ['POST', concrete('/api/v1/invoices/{id}/void')],
      ['POST', concrete('/api/v1/invoices/{id}/send')],
      ['POST', '/api/v1/organizations'],
      ['PATCH', concrete('/api/v1/organizations/{id}')],
      ['POST', concrete('/api/v1/organizations/{id}/staff-provisions')],
      ['POST', concrete('/api/v1/organizations/{id}/billing/trial-activation')],
      ['DELETE', concrete('/api/v1/properties/{id}')],
      ['PATCH', concrete('/api/v1/properties/{id}')],
      ['GET', '/api/v1/tenants'],
      ['POST', '/api/v1/leases'],
    ];
    for (const [method, pathname] of outside) {
      expect(
        mfaRuleForApiRequest({ channel: 'mobile_bearer', method, pathname }),
        `${method} ${pathname}`,
      ).toBe('step_up_if_enrolled');
    }
  });
});
