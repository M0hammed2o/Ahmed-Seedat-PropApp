/**
 * Proplyst V1 multi-factor (TOTP) posture for /api/v1 requests -- one explicit rule per access
 * class, decided by channel, method and path (2026-09-14).
 *
 * Before this, the customer step-up check in proxy.ts only ever looked at the COOKIE session. A
 * bearer-token request (the Android app) was never asked at all -- not because a policy said so,
 * by accident. The V1 policy made explicit:
 *
 *  - Platform administration (/api/v1/admin/*): AAL2 on every channel, enforced by the route itself
 *    (requireAdminRoleOrRespond() -> getAdminSession()). A bearer client has no stored session, so
 *    that check sees no AAL at all and refuses: bearer tokens cannot reach platform administration.
 *  - Sign-in and MFA endpoints (/api/v1/auth/*): the routes manage their own assurance level --
 *    step-up itself has to be reachable at AAL1, and Supabase Auth refuses to unenroll a verified
 *    factor below AAL2.
 *  - Web session (cookie): an account with a verified factor must complete step-up before any other
 *    /api/v1 route (unchanged behaviour).
 *  - Mobile app (bearer token) on an Android V1 route: no step-up. Android V1 has no MFA screen, and
 *    ordinary owner, staff and tenant use of the app is allowed at AAL1 by decision. The list below
 *    is exactly the Android V1 surface, method and path, and a test keeps it identical to
 *    apps/android's WebApi.kt -- it cannot quietly grow to cover anything else.
 *  - Mobile app (bearer token) on ANY other route: the same step-up as the web. A password-only
 *    token for an account with a verified factor cannot drive organisation administration, billing,
 *    staff management or any other route the app does not use.
 *
 * Scope note: this governs the Next.js API. Direct PostgREST/Storage reads with an AAL1 token are
 * governed by row-level security, which grants ordinary organisation data at AAL1 -- consistent with
 * the mobile rule above. Platform-administration data is not exposed to a user JWT by any policy or
 * function; it is only read server-side after the AAL2 check.
 */

export type ApiAuthChannel = 'web_session' | 'mobile_bearer';

export type ApiMfaRule =
  /** The route itself requires AAL2 on every channel (platform administration). */
  | 'route_enforces_aal2'
  /** Sign-in/MFA endpoints: the route manages its own assurance level. */
  | 'route_manages_own_aal'
  /** An account with a verified factor must be at AAL2 for this request. */
  | 'step_up_if_enrolled'
  /** Android V1 route on the mobile channel: AAL1 is sufficient by policy. */
  | 'mobile_v1_no_step_up';

const ID = '[^/]+';

/** Every /api/v1 endpoint the Android V1 app calls -- apps/android/.../data/network/WebApi.kt. */
export const MOBILE_V1_API_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'GET', path: '/api/v1/announcements' },
  { method: 'POST', path: '/api/v1/announcements/{id}/acknowledge' },
  { method: 'GET', path: '/api/v1/document-categories' },
  { method: 'GET', path: '/api/v1/documents' },
  { method: 'POST', path: '/api/v1/documents' },
  { method: 'GET', path: '/api/v1/documents/{id}' },
  { method: 'POST', path: '/api/v1/expenses' },
  { method: 'GET', path: '/api/v1/insights' },
  { method: 'GET', path: '/api/v1/invoices' },
  { method: 'GET', path: '/api/v1/invoices/{id}' },
  { method: 'GET', path: '/api/v1/invoices/{id}/payments' },
  { method: 'POST', path: '/api/v1/invoices/{id}/payments' },
  { method: 'GET', path: '/api/v1/invoices/{id}/pdf' },
  { method: 'GET', path: '/api/v1/organizations/{orgId}/budget/annual' },
  { method: 'GET', path: '/api/v1/organizations/{orgId}/financial-summary' },
  { method: 'GET', path: '/api/v1/payment-reports' },
  { method: 'POST', path: '/api/v1/payment-reports/{id}/confirm' },
  { method: 'POST', path: '/api/v1/payment-reports/{id}/reject' },
  { method: 'GET', path: '/api/v1/properties' },
  { method: 'GET', path: '/api/v1/properties/{id}' },
  { method: 'GET', path: '/api/v1/properties/{id}/budget/annual' },
  { method: 'GET', path: '/api/v1/properties/{id}/financial-summary' },
  { method: 'GET', path: '/api/v1/properties/{id}/tenant-payment-status' },
  { method: 'GET', path: '/api/v1/properties/{id}/utility-meters' },
  { method: 'POST', path: '/api/v1/properties/{id}/utility-meters' },
  { method: 'POST', path: '/api/v1/tenant-portal/maintenance-tickets' },
  { method: 'POST', path: '/api/v1/tenant-portal/maintenance-tickets/{id}/documents' },
  { method: 'POST', path: '/api/v1/tenant-portal/payment-reports' },
  { method: 'GET', path: '/api/v1/utility-meters/{id}/readings' },
  { method: 'POST', path: '/api/v1/utility-meters/{id}/readings' },
  // Google Play requires in-app account deletion, and the app has no MFA screen: an account with a
  // verified factor would otherwise have no in-app deletion path at all.
  { method: 'POST', path: '/api/v1/account/delete' },
];

const MOBILE_V1_MATCHERS = MOBILE_V1_API_ROUTES.map(({ method, path }) => ({
  method,
  pattern: new RegExp(`^${path.replace(/\{[^}]+\}/g, ID)}/?$`),
}));

export function isMobileV1ApiRoute(method: string, pathname: string): boolean {
  const upper = method.toUpperCase();
  return MOBILE_V1_MATCHERS.some((m) => m.method === upper && m.pattern.test(pathname));
}

export function mfaRuleForApiRequest(input: {
  channel: ApiAuthChannel;
  method: string;
  pathname: string;
}): ApiMfaRule {
  const { channel, method, pathname } = input;
  if (pathname.startsWith('/api/v1/admin/') || pathname === '/api/v1/admin')
    return 'route_enforces_aal2';
  if (pathname.startsWith('/api/v1/auth/')) return 'route_manages_own_aal';
  if (channel === 'mobile_bearer' && isMobileV1ApiRoute(method, pathname))
    return 'mobile_v1_no_step_up';
  return 'step_up_if_enrolled';
}
