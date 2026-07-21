# Deployment

Not yet performed in Phase 1 (no production deploy has happened — this document specifies the intended process).

## Supabase

1. `supabase projects create` (or use an existing project) → record project ref in `ENVIRONMENT.md`/secret store, never in Git.
2. `supabase link --project-ref <ref>`.
3. `supabase db push` to apply `supabase/migrations/*` in order.
4. Create the private storage bucket(s) per `supabase/migrations/*_storage_buckets.sql` (bucket creation is included as a migration using the `storage.buckets`/`storage.objects` policy APIs so it's reproducible, not a manual Studio click).
5. Deploy edge functions: `supabase functions deploy <name>` once Phase 2 implements them; set their secrets with `supabase secrets set`.

## Admin dashboard (apps/admin)

Target: Vercel (or any Next.js-compatible host). Environment variables from `apps/admin/.env.example` set in the hosting provider's secret store — `SUPABASE_SERVICE_ROLE_KEY` marked server-only/never exposed to the client bundle. Build: `pnpm --filter admin build`.

## Mobile (apps/mobile)

EAS Build, once an Expo/EAS account exists (external account not yet connected — see final report). `eas.json` (created in Phase 1) defines `development`, `preview`, `production` build profiles. Store submission (App Store Connect / Google Play Console product identifiers, signing certificates) is explicitly out of scope until those accounts are provisioned by Mohammed.

## CI

`.github/workflows/ci.yml` (created in Phase 1) runs on every push/PR: install → format check → lint → typecheck → test → admin build. It does not deploy anything — deployment remains a manual, confirmed action.
