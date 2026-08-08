import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// PWA_V1_COMPLETION_PLAN.md #19, TECHNICAL_DEBT_REGISTER.md TD-10. Thin wrapper over the
// check_rate_limit() Postgres function (migration 20260101000058) -- callable with either the
// caller's own session-bound client or the service-role client, since the RPC works identically
// either way (security definer, default-privilege EXECUTE grant to anon/authenticated/service_role).

/**
 * Returns a 429 NextResponse if the caller has exceeded `limit` requests per `windowSeconds` for
 * `bucketKey`, or null if the request should proceed. `bucketKey` should already include the
 * route/action name (e.g. `billing-webhook:${ip}`) -- this function does not namespace it itself.
 */
export async function rateLimitOrRespond(
  supabase: SupabaseClient,
  bucketKey: string,
  limit: number,
  windowSeconds: number,
): Promise<NextResponse | null> {
  const { data: allowed, error } = await supabase.rpc('check_rate_limit', {
    p_bucket_key: bucketKey,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  // Fail open, not closed: a rate-limit infrastructure error should never itself take down a
  // legitimate request (the same posture SECURITY.md takes for every non-authorization check in
  // this codebase -- this is throttling, not access control, so the failure mode is "no
  // protection this request" not "deny everyone").
  if (error) {
    console.error(
      `[rateLimit] check_rate_limit RPC failed for bucket "${bucketKey}"`,
      error.message,
    );
    return null;
  }

  if (allowed === false) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' } },
      { status: 429 },
    );
  }

  return null;
}
