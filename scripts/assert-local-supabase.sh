#!/bin/bash
# Hard environment assertion (P0 safety requirement, WORKLOG.md this date -- added after a real
# incident: apps/admin/.env.local was read and used against the Supabase Admin API without checking
# which project it pointed at, and it pointed at PRODUCTION). Source this at the top of ANY script
# that will mutate Supabase state (creating users/orgs/business data, running seed/QA fixtures,
# driving a browser against a live app) -- it exits non-zero and refuses to continue unless the
# resolved Supabase URL is unambiguously a local instance.
#
# Usage:
#   source scripts/assert-local-supabase.sh "$SUPABASE_URL"
# or, to read it from an env file the same way the app does:
#   source scripts/assert-local-supabase.sh "$(grep '^NEXT_PUBLIC_SUPABASE_URL=' apps/admin/.env.local | cut -d= -f2-)"
#
# Never prints the service-role key or any other secret -- it only ever inspects/echoes the URL,
# which is not a credential.

assert_local_supabase() {
  local url="$1"
  if [ -z "$url" ]; then
    echo "REFUSED: no Supabase URL was provided to assert_local_supabase() -- nothing to check." >&2
    return 1
  fi

  # Reject any *.supabase.co host explicitly, regardless of scheme/port -- this is the exact
  # pattern that caused the incident.
  if echo "$url" | grep -qiE '(^|//)([a-z0-9-]+\.)?supabase\.co'; then
    echo "REFUSED: '$url' resolves to a hosted Supabase project (*.supabase.co), not local. This script will not run against it." >&2
    return 1
  fi

  # Require an explicit local host -- 127.0.0.1 or localhost only.
  if ! echo "$url" | grep -qiE '//(127\.0\.0\.1|localhost)([:/]|$)'; then
    echo "REFUSED: '$url' is not an explicit local Supabase URL (127.0.0.1 or localhost). This script will not run against it." >&2
    return 1
  fi

  echo "OK: '$url' is a local Supabase instance -- proceeding."
  return 0
}

if [ -n "${1:-}" ]; then
  assert_local_supabase "$1" || exit 1
fi
