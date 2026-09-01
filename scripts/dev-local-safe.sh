#!/bin/bash
# Safe local dev-server launcher (tenant-portal release-gate pass, WORKLOG.md this date).
#
# apps/admin/.env.local points at production -- this script NEVER reads it. It exports the local
# Supabase connection as process-level environment variables (Next.js env precedence: process.env
# always wins over any .env* file, so these values override .env.local for the lifetime of this
# process without ever touching that file) and hard-asserts the resolved URL is genuinely local
# before starting the server. Refuses to start if the assertion fails.
set -euo pipefail
cd "$(dirname "$0")/.."

source scripts/local-supabase-env.sh
source scripts/assert-local-supabase.sh
assert_local_supabase "$NEXT_PUBLIC_SUPABASE_URL" || { echo "REFUSING to start dev server -- environment assertion failed." >&2; exit 1; }

# apps/admin/.env.local also force-enables ADMIN_DEMO_MODE (NEXT_PUBLIC_DEMO_MODE +
# ALLOW_DEMO_MODE both true), which makes every admin/tenant-portal page render hardcoded mock
# data instead of hitting Supabase at all -- fine as a safety net for casual `npm run dev`, but it
# would make this release-gate testing meaningless (nothing would actually exercise RLS, real
# cross-tenant isolation, or the payment architecture just corrected). Forcing it off here
# restores real Supabase-backed rendering, now safely against the local instance only.
export NEXT_PUBLIC_DEMO_MODE=false

cd apps/admin
exec npm run dev -- "$@"
