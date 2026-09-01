#!/bin/bash
# Local-only Supabase connection constants (tenant-portal release-gate pass, WORKLOG.md this date).
#
# apps/admin/.env.local points at PRODUCTION (radqoboichldiucydrgy.supabase.co) -- this file exists
# so that no script or dev-server launch ever needs to read that file to reach the local instance.
# The values below are the standard Supabase CLI local-dev demo keys (issuer "supabase-demo"),
# identical on every machine that runs `supabase start` -- NOT production secrets, and already
# hardcoded in this repo's own existing test files (e.g.
# apps/admin/app/api/v1/documents/[id]/__tests__/route.compliance-access.test.ts). They authenticate
# against 127.0.0.1:54321 only and have zero reach beyond the local Docker containers.
#
# Usage: source scripts/local-supabase-env.sh   (then run scripts/assert-local-supabase.sh to verify
# before doing anything that mutates state)

export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

echo "Local Supabase env exported: NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL (keys set, not printed)"
