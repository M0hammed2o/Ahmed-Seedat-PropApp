# PropVault

A secure, modern SaaS mobile application for individual owners of multiple properties: a personal property **document vault and payment-tracking** app. Not a property-agency ERP, rental-management platform, or accounting package. "PropVault" is a temporary internal product name (see PROJECT.md).

Customers register, subscribe, add properties, upload bills/statements/receipts/proofs of payment, get documents auto-organised and (eventually) auto-extracted, track paid/unpaid/overdue status per property per month, and unlock the app with biometrics. A separate web dashboard lets the SaaS operator run the business.

Full product/architecture context: PROJECT.md, ARCHITECTURE.md, DATABASE.md, SECURITY.md, SUBSCRIPTIONS.md, DOCUMENT_INTELLIGENCE.md, DESIGN_SYSTEM.md, ADMIN_DASHBOARD.md, DEPLOYMENT.md, TESTING.md, PRIVACY_AND_COMPLIANCE.md, DECISIONS.md, WORKLOG.md, TODO.md, KNOWN_BUGS.md, ENVIRONMENT.md.

## Monorepo structure

```
apps/
  mobile/   Expo Router app (iOS/Android) — customer-facing
  admin/    Next.js App Router app — SaaS operator dashboard
packages/
  ui/         design tokens shared by both apps
  types/      shared TypeScript domain/DB types
  validation/ shared Zod schemas
  config/     env schema, feature flags, entitlements, plan limits
  utils/      pure logic: dates, currency, file validation, payment-match scoring
supabase/
  migrations/ committed SQL schema + RLS (source of truth for the DB)
  functions/  edge functions (Phase 2+)
  seed/       local dev seed data
```

## Prerequisites

- Node.js 20+ (see `.nvmrc`)
- pnpm 9+ (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- For mobile native builds: Expo Go (quick preview) or an EAS development build; Xcode/Android Studio for simulators.
- For local Supabase: Docker + the Supabase CLI (`supabase`), for `supabase start`.
- GitHub CLI (`gh`) is used for repo operations in this project but isn't required to develop.

## Install

```bash
pnpm install
```

## Environment configuration

Copy the example env files and fill in real values (never commit the real files):

```bash
cp apps/mobile/.env.example apps/mobile/.env
cp apps/admin/.env.example apps/admin/.env.local
```

See ENVIRONMENT.md for the authoritative variable list, what's required for Phase 1 local dev vs. deferred to later phases, and ownership/rotation notes.

## Supabase setup

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push          # applies supabase/migrations in order
```

For fully local development: `supabase start` (requires Docker) spins up local Postgres/Auth/Storage; point the app env files at the printed local URL/anon key instead of a hosted project.

## Demo mode (no Supabase project required)

Both apps run entirely on realistic mock data by default — `EXPO_PUBLIC_DEMO_MODE`/`NEXT_PUBLIC_DEMO_MODE` default to `true` when unset, specifically so the product can be demonstrated with zero backend setup. Just run:

```bash
pnpm --filter mobile dev        # expo start — press w for web, or scan the QR code
pnpm --filter admin dev         # admin dashboard at localhost:3000, any login credentials work
```

**This is not a safe default for a real deployment.** Demo mode makes the admin login accept any credentials and bypasses auth entirely — see the release-blocking warning at the top of SECURITY.md. Set both flags to `false` explicitly, with real Supabase credentials, before deploying anywhere reachable by anyone other than the person driving a demo.

## Mobile development

```bash
pnpm --filter mobile dev        # expo start
```

Subscription mock mode is on by default (`EXPO_PUBLIC_SUBSCRIPTION_MODE=mock`) so the full paywall/restore/entitlement flow works with zero App Store/Play Console setup. See SUBSCRIPTIONS.md. Set `EXPO_PUBLIC_DEMO_MODE=false` plus real `EXPO_PUBLIC_SUPABASE_URL`/`ANON_KEY` to run against a live project instead of mock data.

## Admin development

```bash
pnpm --filter admin dev
```

With `NEXT_PUBLIC_DEMO_MODE=false`, requires `SUPABASE_SERVICE_ROLE_KEY` locally for server-side admin routes (server-only — never exposed to the browser bundle; see SECURITY.md). An `admin_users` row must exist for your Supabase Auth user to reach `(dashboard)` routes.

## Testing

```bash
pnpm test          # runs vitest (packages, admin) + jest-expo (mobile) via Turborepo
```

RLS/policy SQL tests live in `supabase/tests/` and run via `supabase test db` against a local instance (Docker) — not run automatically by `pnpm test`. See TESTING.md for current coverage and what's blocked in a sandbox without Docker.

## Database migrations

New migration: `supabase migration new <name>` inside `supabase/`, edit the generated SQL, then `supabase db push`. Never edit an already-applied/committed migration file — add a new one.

## Development subscription mock

`apps/mobile/src/features/subscriptions/MockSubscriptionProvider.ts` simulates offerings, purchase, restore, and all subscription states without any store account. Switch to the real RevenueCat SDK by setting `EXPO_PUBLIC_SUBSCRIPTION_MODE=revenuecat` once product identifiers exist.

## Production subscription setup (later phase)

Create products in App Store Connect and Google Play Console, configure them in the RevenueCat dashboard, set `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS`/`_ANDROID`, flip `EXPO_PUBLIC_SUBSCRIPTION_MODE=revenuecat`, and deploy the RevenueCat webhook Edge Function (Phase 2) with `REVENUECAT_WEBHOOK_SECRET` set.

## EAS build preparation (later phase)

`eas.json` defines `development`/`preview`/`production` profiles. Actual builds/submission require an Expo account linked via `eas login` and Apple/Google developer accounts — not yet connected (see final delivery report for exactly what Mohammed needs to provide).
