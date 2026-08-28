import 'server-only';

// Landlord/staff launch-hardening pass (WORKLOG.md 2026-08-26), Section 34: two real production
// bugs were manually found where a raw Postgres/PostgREST error string ("null value in column
// account_id...", "DELETE requires a WHERE clause") reached the end user directly, because the
// calling route did `message: error.message` straight from a Supabase/RPC error object. That
// pattern exists at ~80 call sites across this app (a full sweep is scoped as a P1 follow-up, not
// this pass) -- this helper is the one new, reusable mechanism, applied first to the two routes
// with a manually-confirmed leak (expense recording, owner-statement generation).
//
// Deny-by-default, not a blocklist of "known-bad" patterns: unless the message matches one of
// this codebase's own established prefixed-exception convention (`raise exception
// 'some_code: friendly text'`, already used by commercial_setup_required/property_limit_reached/
// owner_subscription_required/chart_of_accounts_incomplete), the caller-supplied fallback is
// always returned instead -- never the raw message. The real error is still logged server-side
// (visible in Render/Supabase logs), so nothing is hidden from engineering, only from the browser.
const KNOWN_SAFE_PREFIXES = [
  'commercial_setup_required:',
  'property_limit_reached:',
  'owner_subscription_required:',
  'chart_of_accounts_incomplete:',
];

export function safeErrorMessage(
  error: { message: string },
  fallback: string,
  context?: string,
): string {
  for (const prefix of KNOWN_SAFE_PREFIXES) {
    if (error.message.startsWith(prefix)) {
      return error.message.slice(prefix.length).trim();
    }
  }
  console.error(`[safeError]${context ? ` ${context}:` : ''}`, error.message);
  return fallback;
}
