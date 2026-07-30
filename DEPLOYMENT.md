# Deployment

This document describes PropertyVault's intended deployment architecture — for the web app (`apps/admin`, being renamed `apps/web` per `ARCHITECTURE.md`), the native iOS app (`apps/ios`, not yet scaffolded), the native Android app (`apps/android`, not yet scaffolded), and Supabase. **Nothing below has been executed as a real deploy yet** — no production Supabase project, no Vercel project, no Apple/Google developer accounts are provisioned as of this writing (`EXISTING_CODEBASE_AUDIT.md` §1/§8, `MOBILE_ARCHITECTURE_DECISION.md` §1). This is the specification the team builds the pipeline against, not a record of what has run.

Superseded from the PropVault-era version of this document: single-plan/single-owner Supabase setup, EAS Build for `apps/mobile` (Expo is being retired per `MOBILE_ARCHITECTURE_DECISION.md` — native Xcode/Gradle projects replace it), and the "deployment is a manual, out-of-scope action" framing (production deploys are now a defined, gated pipeline step, not undefined). Retained from PropVault: the `.env.example`/real-`.env` split, the CI secret-scan step, the `packages/config`/`packages/utils` provider-abstraction pattern (`featureFlags`, `errorMonitoring`) — see §6/§8.

---

## 1. Environments

| Environment    | Backend                                                                                                                                                                                                                                                                                                                                                                                                                                     | Purpose                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local**      | Docker, `supabase start` (local Postgres/Auth/Storage/Storage). Demo-mode flag (`NEXT_PUBLIC_DEMO_MODE`/`EXPO_PUBLIC_DEMO_MODE` era pattern, carried forward with its default-ON risk fixed per `SECURITY.md`) available for zero-backend UI iteration.                                                                                                                                                                                     | Day-to-day development; `supabase/migrations/*` applied locally via `supabase db push` or `supabase migration up` before any app code that depends on the schema is written. |
| **Staging**    | A real, separate Supabase project. Seeded with **synthetic multi-org data** specifically for cross-tenant-isolation testing — at least two orgs, each with its own properties/leases/tenants/journal entries, so "org A can never read org B's data" is a standing, repeatable staging check rather than a one-time manual test (`TESTING.md`'s RLS/isolation test cases, currently `Blocked` for lack of a live instance, run here first). | Pre-production verification: RLS policy correctness, migration dry-runs, QA against real (non-demo) auth flows, native app builds pointed at a real backend.                 |
| **Production** | A separate Supabase project again (never the same project as staging). `SUPABASE_SERVICE_ROLE_KEY` is never present in any client bundle — enforced by the existing `server-only`-package pattern plus the CI secret-scan step (§6).                                                                                                                                                                                                        | Real client/tenant data.                                                                                                                                                     |

Each environment's Supabase project ref, URL, and anon key live in that environment's `.env`/CI secret store, never in Git — `ENVIRONMENT.md`'s variable table (below) is retained as the source of truth for which variables exist per app; the _values_ differ per environment.

---

## 2. Web app pipeline (`apps/web`, currently `apps/admin`)

**On every PR** (extends the existing `.github/workflows/ci.yml` `verify` job — install → format:check → lint → typecheck → test → build → secret-scan — unchanged in shape, just re-targeted at `apps/web` once the rename lands):

1. `pnpm install --frozen-lockfile`
2. `pnpm format:check`
3. `pnpm lint`
4. `pnpm typecheck`
5. `pnpm test`
6. `pnpm --filter web build` (with `NEXT_PUBLIC_DEMO_MODE=true`, same as today — CI never needs a live Supabase project to confirm the build compiles)
7. Secret-scan grep (unchanged pattern)

A PR cannot merge to `main` unless all of the above pass — this is the existing branch-protection behavior, retained.

**On merge to `main`**: automatic deploy to **staging** (Vercel or equivalent Next.js host), using the staging Supabase project's environment variables. This is the one auto-deploy step in the pipeline — staging holds only synthetic data, so an automatic deploy on every merge carries no client-data risk.

**Production deploy**: **not automatic.** A merge to `main` never deploys straight to production. Promotion is an explicit, separate step — e.g., a maintainer triggers a "Promote staging → production" workflow (tagging the exact commit SHA that was verified on staging) or approves a manual "Deploy to production" gate in the hosting platform. Rationale: this is a multi-tenant SaaS holding real landlord/tenant/financial data (`ACCOUNTING.md`); auto-deploying every merge straight to production removes the last human checkpoint between "CI passed" and "real client data is at risk," and CI's automated checks (lint/typecheck/unit tests) do not cover the cross-tenant-isolation and RLS-policy correctness checks that only staging's synthetic multi-org data exercises (`TESTING.md`).

---

## 3. Database migrations

- Applied via **CI**, as part of the deploy pipeline (`supabase db push` or `supabase migration up` against the target project, run by a CI job authenticated with a scoped Supabase access token stored as a CI secret) — **never manually** against staging or production, and never through the Supabase Studio UI without a matching migration file (`DATABASE.md` line 3, restated here as a deploy-pipeline rule, not just a schema-design rule).
- Staging migrations run automatically alongside the staging app deploy (§2). Production migrations run as part of the same gated promotion step as the production app deploy — a migration and the app code that depends on it are promoted together, never independently, so the deployed app version and the deployed schema version never drift apart.
- **Forward-only.** No down-migration is relied upon in production. A bad migration is fixed by writing and applying a new forward migration that corrects it — mirroring the reversing-entry philosophy `ACCOUNTING.md` §1 applies to the ledger itself ("no financial record is ever edited after posting... every correction is a new entry, the original is untouched forever"). The same logic applies at the schema layer: a migration that already ran against a database holding real tenant data is not rewritten or rolled back destructively; the fix is a new migration file.
- **RLS policy changes get the same review rigor as schema changes** — a pull request touching `supabase/migrations/*` policy definitions requires the same CI pass (§2) plus explicit reviewer attention to the policy predicate itself, because a broken RLS policy (e.g., a dropped `org_id` filter) is a cross-tenant data breach, not merely a bug to fix in the next release. `DATABASE.md` §12's rule — every table's `select`/`insert`/`update`/`delete` policy resolves org membership server-side, never trusting a client-supplied claim — is the thing under review, not just whether the migration runs cleanly.
- Storage bucket policies are themselves migration files (`storage.buckets`/`storage.objects` policy APIs, `DATABASE.md` §6/`DEPLOYMENT.md`-era pattern retained from PropVault) — bucket creation and policy changes go through the same pipeline, never a manual Studio click.

---

## 4. iOS pipeline (`apps/ios`)

Not yet scaffolded — no `.xcodeproj`/`.xcworkspace` exists in the repo (`MOBILE_ARCHITECTURE_DECISION.md` §1). This section specifies the pipeline the project is built against once it exists.

**Recommendation: Xcode Cloud**, not self-hosted Fastlane + Fastlane Match, per the "simpler architecture" default-decision rule (`DECISIONS.md`'s pattern of favoring the lower-operational-overhead option for a small team — see e.g. the pnpm/Turborepo and no-shared-RN-web-layer decisions). Xcode Cloud's managed signing removes the operational burden of hosting and rotating a Match certificate repository, and integrates directly with the existing Apple Developer account and TestFlight — a meaningfully simpler setup than self-hosted Fastlane Match for a team of this size. Fastlane remains a fallback if Xcode Cloud's build-config flexibility proves insufficient later (e.g., complex multi-target/multi-scheme fan-out).

Pipeline stages:

1. **Build** — triggered on PR (build-only, catches compile errors) and on merge to `main` (full pipeline).
2. **Test** — run the XCTest suite (unit + UI tests as they're built out).
3. **TestFlight — internal** — automatic distribution to the internal testing group (team members) on every successful `main` build.
4. **TestFlight — external beta** — promoted manually from an internal build once it's been exercised internally; external beta requires Apple's Beta App Review (automatic on first submission per build, lighter than full App Review).
5. **App Store submission** — **manual gate.** A maintainer explicitly promotes a specific TestFlight build to App Store review; this is never automatic on merge, because App Store review is slow (typically 1–3 days) and costly to iterate on if a rejected build was pushed without a deliberate decision to submit it. Store review is a bigger blast-radius/slower-feedback step than a web deploy, so it gets its own explicit human checkpoint distinct from the staging→production web gate in §2.

Code signing: Xcode Cloud's managed signing (certificates/provisioning profiles generated and rotated automatically, scoped to the Apple Developer Program account once provisioned).

---

## 5. Android pipeline (`apps/android`)

Not yet scaffolded — no `build.gradle`/`AndroidManifest.xml` exists in the repo (`MOBILE_ARCHITECTURE_DECISION.md` §1). This section specifies the pipeline the project is built against once it exists.

**Recommendation: GitHub Actions running the Android Gradle Plugin directly**, with Fastlane layered in specifically for Play Console upload/track-promotion steps (Fastlane's `supply` action is the standard, well-supported way to script Play Console releases; hand-rolling Play Developer API calls would duplicate what Fastlane already does reliably) — consistent with the same "simpler architecture" default applied to iOS: GitHub Actions is already the CI platform for the rest of the monorepo (`.github/workflows/ci.yml`), so extending it rather than introducing a second CI system (e.g., a dedicated Android CI product) keeps operational surface area down for a small team.

Pipeline stages:

1. **Build** — `./gradlew assembleRelease` (or the appropriate variant), triggered on PR (build-only) and on merge to `main` (full pipeline).
2. **Test** — unit tests (`./gradlew test`) and instrumented tests (`./gradlew connectedAndroidTest`, run against a CI-managed emulator or device farm) as they're built out.
3. **Play Console — internal testing track** — automatic upload on every successful `main` build (Fastlane `supply` with `track: internal`).
4. **Production rollout — staged, not 100% on day one.** Promotion from internal testing to production is a manual step; production rollout itself starts at a small percentage (e.g., 5–10%) via Play Console's staged-rollout mechanism and is manually increased once no elevated crash rate/ANR rate is observed, rather than releasing to 100% of users immediately — so a bad release is caught (and can be halted) while it's still affecting a small fraction of the install base.

Code signing: upload key stored in the CI platform's secure secret store (GitHub Actions encrypted secrets), never committed — Play App Signing manages the actual distribution-signing key on Google's side, standard practice since Android App Bundles became the required upload format.

---

## 6. Secrets management

- **Web app**: environment variables injected by the hosting platform's (Vercel-or-equivalent) secret store per environment (staging vs. production get distinct values for the same variable names). Never committed — the `.env.example`/real-`.env` split from `ENVIRONMENT.md` is retained: `apps/web/.env.example` documents every variable's purpose and whether it's required, real values only ever exist in `.env`/`.env.local` locally or in the platform's secret store when deployed. `SUPABASE_SERVICE_ROLE_KEY` is explicitly marked server-only, never `NEXT_PUBLIC_`-prefixed, matching the existing convention.
- **CI**: the existing secret-scan grep step (`.github/workflows/ci.yml`, pattern-matching for live Stripe/Supabase/Google keys and PEM private key headers) is retained unchanged as a defense-in-depth check against an accidentally-committed real credential, independent of the `.env`/secret-store discipline above.
- **Native apps**: RevenueCat API keys, push notification certificates (APNs key for iOS, FCM service account for Android), and code-signing credentials are stored in each platform's own secure CI secret store — Xcode Cloud environment variables/managed signing for iOS (§4), GitHub Actions encrypted secrets for Android (§5) — never committed to the repo, mirroring the same never-in-Git rule as the web app's variables. The `RevenueCatSubscriptionProvider`/`MockSubscriptionProvider` abstraction pattern (`SUBSCRIPTIONS.md`, originally built for `apps/mobile`) is retained conceptually for the native apps: a swappable provider interface so builds can run against a mock provider before real store product identifiers exist, exactly as documented for the Expo app.
- **Migration/CI Supabase access**: the CI job that runs `supabase db push` (§3) authenticates with a scoped Supabase access token (not the service-role key) stored as a CI secret, distinct per environment (staging token vs. production token) so a compromised staging credential cannot touch production.

---

## 7. Rollback strategy

- **Web app**: redeploy the previous build artifact — near-instant on Vercel-or-equivalent (this is the platform's native "promote a previous deployment" mechanism). No rebuild required for a rollback of app code alone.
- **Database**: **never a destructive rollback** against a live multi-tenant database. A bad migration is fixed by writing and applying a new forward migration that corrects the problem (§3) — the same forward-only principle `ACCOUNTING.md` §1 applies to the ledger applies here: an already-applied migration touching real tenant data is not reverted, because a destructive rollback risks losing writes that happened after the bad migration ran, or reintroducing a schema state the app no longer expects. If a migration is caught before it reaches production (staging-only), it can be freely fixed and reapplied since staging holds only synthetic data.
- **Native apps**: **cannot truly be "rolled back"** once a version is live on the App Store/Play Store — Apple and Google don't support reverting a public release to a prior binary. The actual mitigations, in order of speed:
  1. **Staged rollout halt** (Android): pause or roll back the staged-rollout percentage in Play Console before it reaches 100% (§5) — this is the closest thing Android has to a rollback, and only works because rollout wasn't 100% on day one.
  2. **Kill-switch feature flags**: `packages/config`'s `FeatureFlags` pattern (`verifiedAutomaticPaymentMatching`, `pushNotificationsEnabled`, etc. — currently static Phase 1 defaults, designed per its own doc comment to become a real `feature_flags` table read without changing caller shape) is the actual mitigation for a bad native release — a broken feature can be disabled server-side without an app update, reaching every installed copy of the app immediately regardless of store-review turnaround. This is why native features with meaningful blast radius should ship behind a flag from the start, not added retroactively only once something breaks.
  3. **Expedited fix release**: for anything a flag can't mitigate (e.g., a crash on launch), the only path is a new build through the full pipeline (§4/§5) submitted for review as fast as possible — iOS's App Store review and Android's Play review both offer no meaningfully faster "hotfix" lane than a normal submission, which is precisely why the manual App Store submission gate (§4) and staged Android rollout (§5) exist to catch problems before most users ever see them.

---

## 8. Monitoring / alerting

- **Error monitoring**: `packages/utils`'s `ErrorReporter` abstraction (`ConsoleErrorReporter` in Phase 1, `AppError`/`ErrorSeverity`/`scrubContext` shape already defined in `packages/utils/src/errorMonitoring.ts`) is retained and extended with a real backend (e.g. Sentry, as the interface's doc comment anticipates) wired into both the web app and, once built, the native apps — swapping the reporter implementation, not the call sites. `scrubContext` (which strips `token|password|secret|key|biometric|document|file`-matching keys before an error ever reaches a reporter) is retained unchanged — this is what keeps error reports compliant with the hard rule against secrets/PII in logs.
- **Accounting posting-invariant alert**: `ACCOUNTING.md` §6's Trial Balance "Balanced" check (`SUM(all debits) = SUM(all credits)` across an org's ledger) is computed live from `journal_lines`. In production, this check should run on a schedule (not only on-demand when a user opens the Trial Balance screen) and **page engineering if it ever evaluates false** — an unbalanced ledger means the posting service's own `SUM(debit) = SUM(credit)`-per-entry validation (`ACCOUNTING.md` §1/§3) was bypassed somewhere, which is a data-integrity violation on financial records, not a cosmetic bug. This is a higher-severity alert than a generic error-rate threshold precisely because it indicates the immutability/balance invariant the whole accounting subsystem depends on has already been violated, not merely that it might be about to fail.
- **Deploy/CI visibility**: CI failures on `main` (post-merge, not just PR) should alert the team promptly, since a failure at that point means staging's automatic deploy (§2) did not go out as expected.

---

## 9. Backup and disaster recovery (added by Production Readiness Review, 2026-07-30 — previously unaddressed)

Not designed prior to this review, a real gap for a system holding real client financial/tenancy records.

- **Database backups**: Supabase's automated daily backups (retention tier depends on the plan — confirm the production project's plan includes **Point-in-Time Recovery (PITR)**, not just daily snapshots, before go-live; PITR is the difference between "lost up to a day of writes" and "lost up to a few minutes," and for a financial ledger the former is not acceptable). **Decision**: production requires PITR enabled from day one, not added later — this is a plan-tier choice made at Supabase-project-provisioning time, cheap to get right upfront and disruptive to add retroactively.
- **Backup retention**: minimum 30 days of PITR window, minimum 12 months of periodic (e.g. monthly) snapshot retention for longer-horizon recovery — exact numbers are a cost/risk tradeoff Mohammed should confirm before launch (flagged in `RISK_REGISTER.md`), not decided unilaterally here.
- **Restore testing**: a documented, actually-executed restore drill (restore the latest backup into a scratch project, verify the app can run against it) runs on a fixed cadence (recommend quarterly) — an untested backup is not a real backup; this is a checklist item for `TASKS.md` M24/M25, not a one-time setup step.
- **RTO/RPO targets**: proposed as a starting point, not yet validated against real infrastructure — **RPO (data loss tolerance): ≤5 minutes** (achievable via PITR), **RTO (time to restore service): ≤4 hours** for a full regional Supabase outage requiring restore-from-backup into a new project. These targets should be confirmed or revised once the team has actually run a restore drill and knows how long it really takes.
- **Cross-region backup replication**: not done in V1 (single-region Supabase project) — flagged in `RISK_REGISTER.md` as a single-region dependency; revisit if/when multi-region readiness (below) becomes a real requirement.

## 10. Multi-region deployment readiness (added by Production Readiness Review, 2026-07-30)

**V1 is intentionally single-region** (one Supabase project, one primary hosting region) — this is a scoping decision, not an oversight, given the confirmed South Africa-first target market (`DECISIONS.md` 2026-07-29) and a single region local to South Africa is the right latency/cost tradeoff for that market alone. What's done now specifically so this doesn't become expensive to unwind later:

- **`org_id` is already the natural future sharding/partitioning key** — every business table is org-scoped (`DATABASE.md` §0.1), which is exactly the property a future geographic-partitioning strategy (e.g. EU orgs' data in an EU region, SA orgs' data in an SA region) would need. No schema change would be required to support regional partitioning later; it would be an infrastructure/routing change (which region's Supabase project a given `org_id` is provisioned into), not a data-model change.
- **POPIA data-residency**: South African orgs' data staying in a South African (or at minimum, POPIA-compliant) region is already satisfied by the single-region choice, provided the chosen Supabase region is itself POPIA-compliant — confirm the specific region at provisioning time (flagged in `RISK_REGISTER.md`, not decided here).
- **Explicit non-goal for V1**: active multi-region deployment (read replicas in multiple regions, cross-region failover, a global load balancer). This is real infrastructure complexity not justified by the current single-market target — revisit only if/when the product actually expands to a second geography with its own data-residency requirement.

## 11. Observability, logging, and monitoring (added by Production Readiness Review, 2026-07-30 — expands the single paragraph previously in this document into a real strategy)

- **Structured logging**: every server-side log line (API route handlers, Edge Functions, the posting service) is structured JSON, not free-text — minimum fields: `timestamp`, `level`, `org_id` (where applicable), `request_id`, `message`, and a `context` object. `request_id` is generated at the API gateway/edge and propagated through every downstream call (Edge Function invocations, Postgres function calls via a session-local comment/setting) specifically so a single user-facing error can be traced through every layer that touched it — this is the one piece of observability infrastructure that pays for itself immediately in support/debugging time and should exist before any other observability investment.
- **Log retention**: 30 days hot/searchable (for active debugging), archived to cold storage for 12 months (for later incident investigation), then discarded — application logs are operational data, not the permanent record (`audit_events`/`journal_entries` are the permanent record, per §13's retention rule in `DATABASE.md`, and are never subject to this shorter retention).
- **Redaction**: the existing `scrubContext` pattern (`packages/utils/src/errorMonitoring.ts`, retained per §8 below) applies to structured logs too, not just error reports — no log line ever contains a raw secret, token, password, or `encrypted_secrets`-backed value (`DATABASE.md` §11), enforced by the same key-pattern scrubber, not by developer discipline alone.
- **Metrics / SLOs**: three initial service-level objectives, chosen as the minimum meaningful set rather than an exhaustive list to start with — (1) API p95 latency < 500ms for non-report endpoints, (2) API error rate < 0.1% (5xx) over any rolling 5-minute window, (3) the accounting posting service's success rate = 100% (a failed post must be a visible, alerted error, never a silent drop, given `ACCOUNTING.md` §1's immutability guarantee depends on every intended posting actually landing). SLOs are revisited once real production traffic exists to calibrate them against — these are starting targets, not measured commitments yet.
- **Alerting** (extends §8's single existing alert — the Trial Balance "Balanced" check): SLO breaches above page the on-call rotation (once one exists — not yet defined, flagged in `RISK_REGISTER.md` as a pre-launch organizational gap, not a technical one); CI failures on `main` (already specified, §2); backup-restore drill failures (§9); WhatsApp/email provider webhook signature-verification failure spikes (a sudden spike suggests either an attack or a provider API change, both worth knowing about immediately per `SECURITY.md`'s webhook-forgery-protection section).
- **Distributed tracing**: not implemented in V1 — `request_id` propagation (above) gives correlated structured logs, which is sufficient for a system of this size; a full tracing backend (e.g. OpenTelemetry + a tracing UI) is the natural upgrade path once the number of services/Edge-Function hops makes log-correlation alone hard to follow, not built speculatively now.

## 12. Cost optimization (added by Production Readiness Review, 2026-07-30 — previously unaddressed)

- **Storage costs** (documents, photos): the archival policy already noted (`DATABASE.md` §13 — move `documents.storage_path`-backed objects older than a threshold to a cheaper storage tier) is the primary lever; add a per-org storage quota (`plans.feature_limits`, already schema-capable) so cost scales predictably with plan tier rather than being an open-ended liability per org.
- **Usage-metered externals** (WhatsApp sends, email sends, OCR pages, AI tokens): already tracked per org via `usage_events`/`usage_snapshots` (`DATABASE.md` §7, closed by the earlier architecture review) — this is the foundation for both plan-tier usage caps (already specified, `AI_ARCHITECTURE.md` §4 for AI; the same enforcement pattern applies to WhatsApp/email/OCR) and for PropertyVault's own cost visibility per org, which matters directly for unit-economics/pricing decisions as the org count grows.
- **Database compute**: the indexing work in this review (§13's search/RLS-performance fixes) is itself a cost lever — an unindexed query that forces a sequential scan costs real compute at scale, so "index it correctly" and "keep it cheap" are the same fix here, not separate concerns.
- **Edge Function invocation cost**: no specific optimization needed at V1 scale; flagged as a line item to monitor once real usage data exists (`RISK_REGISTER.md`), since serverless-per-invocation billing can scale non-linearly with traffic patterns that aren't yet known.
- **Explicit non-goal for V1**: a dedicated cost-monitoring dashboard or automated budget-alerting system — start with the hosting platform's/Supabase's native billing alerts (a cheap, immediate baseline) and revisit a bespoke solution only if that proves insufficient once real spend data exists.

## 13. Summary by app

| App                 | CI (every PR)                   | Auto-deploy                                     | Gated promotion                                             |
| ------------------- | ------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| `apps/web`          | lint/typecheck/test/build       | staging, on merge to `main`                     | production, explicit promotion step                         |
| Supabase migrations | —                               | staging, alongside web deploy                   | production, alongside web promotion, same commit SHA        |
| `apps/ios`          | build + XCTest                  | TestFlight internal, on merge to `main`         | TestFlight external (manual), App Store submission (manual) |
| `apps/android`      | build + unit/instrumented tests | Play Console internal track, on merge to `main` | Production rollout (manual promotion, staged percentage)    |
