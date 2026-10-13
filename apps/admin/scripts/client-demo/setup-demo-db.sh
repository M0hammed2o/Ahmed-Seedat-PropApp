#!/usr/bin/env bash
# Set up the DEDICATED demo Supabase project: apply every migration in order, then provision the fictional demo.
# Reads apps/admin/.env.demo.local (git-ignored), which must define:
#   DEMO_SUPABASE_URL, DEMO_DB_URL (Session pooler connection string, password filled in),
#   DEMO_ANON_KEY, DEMO_SERVICE_ROLE_KEY, DEMO_LOGIN_EMAIL, DEMO_LOGIN_PASSWORD, [DEMO_TENANT_EMAIL]
# Never prints secrets. Refuses the production project.
set -euo pipefail
cd "$(dirname "$0")/../.."                       # apps/admin
ENV_FILE=.env.demo.local
[ -f "$ENV_FILE" ] || { echo "Missing apps/admin/$ENV_FILE"; exit 1; }
set -a; . "./$ENV_FILE"; set +a
for v in DEMO_SUPABASE_URL DEMO_DB_URL DEMO_ANON_KEY DEMO_SERVICE_ROLE_KEY DEMO_LOGIN_EMAIL DEMO_LOGIN_PASSWORD; do
  [ -n "${!v:-}" ] || { echo "Missing $v in $ENV_FILE"; exit 1; }
done
case "$DEMO_SUPABASE_URL$DEMO_DB_URL" in *radqoboichldiucydrgy*) echo "REFUSING: that is the PRODUCTION project"; exit 1;; esac
echo "Demo project: $(echo "$DEMO_SUPABASE_URL" | sed -E 's#https://([a-z0-9]+)\..*#\1#')"

echo "== Applying migrations to the DEMO database (in order)"
(cd ../.. && yes | npx supabase db push --db-url "$DEMO_DB_URL" --include-all 2>&1 | grep -vE "postgres(ql)?://" | tail -5)

echo "== Provisioning the fictional demo portfolio"
DEMO_CONFIRM=fictional-demo npx vitest run -c vitest.demo.config.ts scripts/client-demo 2>&1 \
  | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests |client demo|Error|refus" | sed -E 's/Login:.*$//'
