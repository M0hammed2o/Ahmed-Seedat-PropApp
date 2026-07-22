# Decisions

Chronological log of non-obvious choices made to keep Phase 0/1 moving without blocking on Mohammed for things that don't materially change the architecture.

## 2026-07-21 — Git repository scoping (found during discovery, not a design choice)

Discovery: the Git repository previously reachable from this machine's default working context was rooted at `C:\Users\junsm` (the entire Windows user profile) — an unrelated, accidental `git init` that would have tracked personal files (`NTUSER.DAT`, `AppData`, `OneDrive`, credential stores, unrelated other projects) had any `git add`/commit been run there. **Action taken:** left that repository completely untouched; initialised a fresh, correctly-scoped Git repository inside `PropValt (Property App)/` and pointed `origin` at the specified GitHub repo (confirmed empty via `gh repo view`). All work in this project happens in that new, correctly-scoped repository.

## 2026-07-21 — Package manager & task runner: pnpm + Turborepo

Reason: pnpm's strict node_modules linking prevents an RN app and a Next.js app from silently sharing an incompatible transitive dependency (a real risk given how different their dependency trees are); Turborepo gives cached/parallel `lint`/`typecheck`/`test`/`build` with minimal config and no vendor lock-in cost.

## 2026-07-21 — Package versions

Verified current-stable via live search on 2026-07-21 (not assumed from training knowledge, since the assistant's knowledge cutoff predates this date by several months): Expo SDK 56 (React Native 0.85, React 19.2), Next.js 16.2.7, `@supabase/supabase-js` 2.110.7, Zod 4.4.3, `react-native-purchases` 10.4.0. Root/tooling packages (`typescript`, `eslint`, `turbo`, `prettier`) are pinned with caret ranges to recent-known-good majors and will resolve to their latest compatible patch in the committed lockfile at install time — the lockfile, not `package.json`, is the source of exact-version truth per the brief's "use exact package versions in the lockfile" rule.

## 2026-07-21 — Zod v4 over v3

Zod 4 is now the current stable major. Risk noted: some `@hookform/resolvers` versions historically lagged Zod major bumps — pinned `@hookform/resolvers` to a version documented (in its own changelog) as Zod-v4-compatible; if `pnpm install` surfaces a peer-dependency conflict, the fallback is Zod `^3.24.1`, which is fully compatible everywhere. This is called out explicitly so it isn't silently wrong if the ecosystem hasn't fully caught up by the time this is installed.

## 2026-07-21 — No shared visual component library across RN and Next.js

`packages/ui` holds design **tokens** (colour/type/spacing/radii/motion) and shared non-visual logic (variant maps, status→icon mapping), not actual components — RN and DOM rendering are different enough (View/Text vs div/shadcn primitives) that a shared component layer would mean either a heavy cross-platform abstraction (React Native Web) the brief never asked for, or a thin thing that saves little. Each app implements its own components against the same tokens, which keeps both apps idiomatic to their platform while staying visually consistent.

## 2026-07-21 — `admin_roles` table deferred; role is an enum column on `admin_users`

The brief lists both `admin_users` and `admin_roles` as entities. Phase 1 uses a single `admin_role` Postgres enum (`super_admin | support_admin | operations_admin | read_only_admin`) directly on `admin_users` rather than a separate join table, since V1 has no requirement for a user to hold multiple roles simultaneously or for roles to be dynamically defined. If multi-role-per-admin or custom roles become a real requirement, `admin_roles` becomes a proper join table in a later migration — documented here so it isn't forgotten.

## 2026-07-21 — Expired/billing-issue subscribers get read-only access, not full lockout

See SUBSCRIPTIONS.md. Chosen because the product's core promise is "your documents are safe here" — losing read access to your own uploaded bills the moment a card fails would contradict that promise and is also explicitly discouraged by the brief ("existing documents must not be deleted merely because a subscription expires"). Implemented as a config flag, not a hardcoded branch, so it's a one-line change if Mohammed wants stricter enforcement later.

## 2026-07-21 — OCR/document-intelligence vendor not selected yet

The brief explicitly says not to implement the full OCR provider in Phase 1 and to keep the abstraction vendor-agnostic. Rather than guessing a vendor (which would bias cost/architecture decisions Mohammed hasn't weighed in on), the interface is built and a mock provider ships; vendor selection is logged as an open question in TODO.md for Phase 2.

## 2026-07-22 — Phase 2: demo mode, default ON, for a same-week client meeting

Scope changed mid-project: the immediate priority became a polished, believable end-to-end demo for a client meeting, explicitly not backend completeness (see WORKLOG.md). Rather than fork a separate "demo build," every screen was built to read through the same repository/provider interface boundary already established in Phase 1 (`SubscriptionProvider`, `DocumentIntelligenceProvider` pattern) — a new `EXPO_PUBLIC_DEMO_MODE`/`NEXT_PUBLIC_DEMO_MODE` flag swaps in an in-memory mock data layer (`apps/mobile/src/demo/`, `apps/admin/lib/demo/`) instead of Supabase, everywhere a screen would otherwise need a live project. Production code paths are untouched, not deleted or bypassed permanently — flipping the flag to `false` restores the exact Phase 1 behavior.

**The flag defaults to ON when unset.** This was a deliberate tradeoff, not an oversight: the whole point of Phase 2 is that the app must work with zero backend setup for tomorrow's meeting, and an opt-in flag that has to be manually set would fail that goal the moment anyone forgets to set it. The cost is real and is treated as release-blocking — see the new section at the top of SECURITY.md — a deployment that leaves this unset ships with a full authentication bypass on the admin app. A boot-time console warning was added specifically because this tradeoff is dangerous enough that it must never be silent.

## 2026-07-22 — Payment-match extraction templates align to real outstanding bills, not hardcoded scores

Rather than faking a "Strong Match Found" result for the demo's AI-matching step, the demo upload flow (`apps/mobile/src/demo/extractionTemplates.ts`) generates a proof-of-payment's amount/reference from whatever the property's actual largest outstanding bill in the store currently is, then runs the real `calculateMatchScore()` from `packages/utils` (the same function unit-tested in Phase 1 and destined for production) against it. The demo is compelling because the real algorithm genuinely scores it high, not because the UI lies about a canned number — this also means the demo doubles as an informal live test of the actual matching logic.

## 2026-07-22 — No charting library added for the admin dashboard

`MiniLineChart`/`MiniBarChart` (`apps/admin/components/ui/`) are hand-rolled inline SVG/div components rather than a pulled-in library (e.g. Recharts). For the handful of simple trend visualisations the brief asked for, a full charting dependency would add bundle weight and a new version-compatibility surface to the "test everything" pass for marginal benefit — revisit if the admin dashboard's charting needs grow materially in a later phase.

## 2026-07-21 — RLS/policy tests written but not executed in this environment

This development sandbox has no Docker/local Supabase instance available to run `supabase start` + `supabase test db` against. Tests are written per TESTING.md and will run once Mohammed (or a CI runner with Docker) executes them locally — reported as Blocked, not claimed as passing, per the project's evidence rule.
