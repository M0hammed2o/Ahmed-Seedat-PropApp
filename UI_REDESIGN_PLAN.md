# UI Redesign Plan — 2026-08-02

## 2026-08-03 update — reference/lovable-ui-reference audit + foundation/Dashboard batch

`reference/lovable-ui-reference/propertyvault-essence-main` (TanStack Start + Tailwind v4 +
shadcn/Radix, purpose-built as PropertyVault's own visual direction) audited alongside
`reference/propview-screenshots/` and the current Owner PWA. Not literally portable (different
router/build tool, Tailwind v4 CSS-first tokens vs this repo's Tailwind v3 JS config) — adapted as
values and patterns, not imported as code. Its own component kit (`kit.tsx`: `PageHeader`, `Panel`,
`Pill`, `Meter`, `Delta`, `Avatar`) and OKLCH design-token system (`styles.css`) were the two
highest-value extracts.

| | |
|---|---|
| **Route/module** | `/dashboard` (Owner Dashboard) + shared design tokens/shell |
| **Functional purpose** | Landing page after portal-session resolution; portfolio-at-a-glance |
| **PropView pattern retained** | Hero greeting + period context, "Key numbers" 4-card KPI grid (icon, big number, label, subtext), money-in/out chart with a real empty state, recent-work feed, quick-actions tile grid (`PROPVIEW_SCREENSHOT_AUDIT.md` IMG_7957-61/7986-89) |
| **Lovable pattern adapted** | OKLCH palette (converted to precise hex, not eyeballed — see `packages/ui/src/tokens.ts` comment), `panel` card language (soft shadow + generous radius), `PageHeader`/`Panel` primitives, area-chart-with-gradient-fill money flow, link-through secondary-stat row with trailing arrow, quick-action icon tiles |
| **Weakness found** | Flat `border p-4` divs everywhere, no shadow/elevation, no display typeface, primitive single-series bar-only charts (`MiniBarChart`), no real activity feed, KPI cards with no icon/hierarchy, quick actions were 5 plain buttons in a row |
| **Improvement made** | New `AdminMetricCard` icon+href variant, `PageHeader`/`Panel` shared components, `recharts`-based `MoneyFlowChart` (real 6-month rent-collected-vs-expenses area chart, gradient fill, tooltip, honest empty state) + `OccupancyMeter` (donut, point-in-time only — no fabricated trend), `RecentActivityFeed` reading real `audit_events`, icon-tile quick actions. New premium palette (blue accent, soft neutrals, real shadow/radius scale), Plus Jakarta Sans display + Inter body via `next/font` (self-hosted, CSP-safe), `animate-rise` entrance |
| **Reusable components built** | `PageHeader`, `Panel`, enhanced `AdminMetricCard` (icon/href props, backward-compatible), `MoneyFlowChart`, `OccupancyMeter`, `RecentActivityFeed` — all available to every subsequent module |
| **Responsive** | Verified 1440/1280/1024/768/390 — 4-col KPI grid collapses to 2-col at `sm`, chart/donut/activity stack to 1 column, quick actions stay a readable 2x2 at mobile width, no horizontal overflow at any width |
| **Accessibility** | Headings remain semantic (`h1` via `PageHeader`), icon-only elements keep adjacent text labels (no icon-only buttons introduced), `prefers-reduced-motion` respected (`animate-rise`/chart transitions disabled via new `globals.css` media query), colour never the only status signal (existing `StatusBadge` pattern untouched) |
| **Verification** | Real `supabase`-independent (no schema touched) — `apps/admin` `tsc --noEmit`/`eslint --max-warnings=0` clean, `vitest` 153/153, real `next build` clean. Real-browser check (puppeteer + system Chrome, demo mode): screenshots at 1440/1280/1024/768/390 light + 1440 dark, zero non-prefetch console/network errors beyond a pre-existing missing-favicon 404 (unrelated, not introduced by this pass). One real bug found and fixed by the browser check itself: the money-flow chart's Y-axis labels were clipped by a copied-from-reference negative margin that didn't suit this chart's tick width — fixed, re-verified. |

No backend/API/schema changes in this batch — pure presentation-layer, per the "primarily a
presentation and interaction-layer transformation" instruction. `packages/ui/src/tokens.ts`'s
`colorLight`/`colorDark` KEY NAMES are unchanged (only the hex values they resolve to changed), so
every existing `text-light-textPrimary`-style class across the whole app kept working with zero
edits required.


Concise by design (per Mohammed's instruction) — full detail already lives in `DESIGN_SYSTEM.md`
(the target visual language, mostly already specified) and `DESIGN_REVIEW.md` (the PropView/Envato
comparison this session's design system was built against). This file is the audit + execution
order on top of those, not a restatement of them.

## Two foundational bugs found by the new browser-audit tooling, before any visual work started

1. **CSP was blocking hydration on every page since the first commit — fixed** (`DECISIONS.md`
   2026-08-02, commit `9ff9ab6`). Every page now genuinely renders in a real browser; this was a
   prerequisite for any of the work below being verifiable at all.
2. **Dark mode has never actually activated anywhere.** `tailwind.config.ts` uses
   `darkMode: 'class'`, which requires a `.dark` class on an ancestor element — nothing in this
   codebase has ever set that class (no `ThemeProvider`, no toggle, `app/layout.tsx` renders a bare
   `<html>`/`<body>`). Every `dark:` utility class written across every module this session
   (dozens of components) is real, correct, and completely unreachable in production. Confirmed by
   screenshot: a `prefers-color-scheme: dark`-emulated capture of `/overview` is pixel-identical to
   light mode. Fixing this (a real theme-activation mechanism, not a new colour system) is folded
   into the design-foundation step below, since every later module's dark-mode verification is
   meaningless until this exists.

## Design direction (already specified, now actually executed)

`DESIGN_SYSTEM.md` already defines the target: calm/"private vault" over generic-admin-dashboard,
single restrained accent, status = colour+icon+label always, tokens centralised in
`packages/ui/src/tokens.ts`. What's missing is execution, not direction:

- **Real theme activation** (see above) + a System/Light/Dark toggle (`DESIGN_SYSTEM.md` already
  calls for this, line 220 — never built).
- **Missing components** (`DESIGN_SYSTEM.md` §"Component foundation" already flags these as not
  yet implemented for admin/web): `SkeletonState` (today's `PageLoading` is a single generic
  pulse block, not shape-matched per screen), `ErrorState`, formal `Button` variant coverage
  (secondary/destructive exist informally via ad hoc classNames, not a shared component),
  segmented control, modal/dialog, toast, drawer, command palette, breadcrumbs, collapsible
  sidebar sections.
- **Responsive sidebar** (`DESIGN_SYSTEM.md` §"Responsive rules" already specifies the fix: icon-only
  ≥`md`, overlay drawer <`md`) — confirmed broken by screenshot at 390px: the full-width sidebar
  never collapses, squeezing every KPI card into ~1-word-wide columns with heavy text wrapping.
- **Visual polish**: current execution uses the right tokens but flat, low-contrast borders, no
  shadow/elevation variety, uniform card treatment regardless of content density — reads as
  "correct but generic," which is exactly Mohammed's own assessment.

## Route inventory (61 `page.tsx` routes across 4 shells)

Grouped by pattern, not listed individually — nearly every route composes the same 5–6 shared
components (`AdminDataTable`, `AdminMetricCard`, `EmptyState`, `StatusBadge`, `PageLoading`,
`Button`), so fixing those + the 3 shell layouts changes the visual language everywhere at once.

| Group | Routes (examples) | Shell | Classification |
| --- | --- | --- | --- |
| App shells | `(dashboard)/layout.tsx`, `(super-admin)/layout.tsx`, `(tenant)/layout.tsx` | — | **Needs substantial redesign** — no responsive collapse, no theme toggle, flat nav list with no active-state treatment, no breadcrumbs |
| Dashboards | `/overview`, `/dashboard` | super-admin, dashboard | Needs substantial redesign — KPI cards/charts functionally solid (just verified real), visual density/hierarchy needs work |
| List+detail modules | properties, units, tenants, leases, owners, maintenance, inspections, applications, documents, customers, subscriptions | dashboard, super-admin | Acceptable with refinement — `AdminDataTable`/`EmptyState`/`StatusBadge` pattern is sound, needs the component-level polish pass, not a rebuild |
| Accounting | rent-due, expenses, bank-accounts, bank-transactions, trial-balance | dashboard | Acceptable with refinement — same table pattern; numeric-heavy, benefits most from tabular-nums + right-alignment polish |
| Forms (new/edit) | ~20 `new`/`[id]/edit` routes | dashboard | Acceptable with refinement — consistent hand-rolled form markup, needs the shared input/label/segmented-control components once built |
| Reports | `/reports` | dashboard | Acceptable with refinement — chart components already dependency-free and reused |
| Tenant portal | `/my-lease`, `/my-payments`, `/my-maintenance(+/new)`, `/notices` | tenant | Acceptable with refinement — deliberately simple per V1 scope, keep it that way |
| Auth/onboarding | `/login`, `/onboarding/create-organization` | none | Acceptable with refinement — functionally correct (just fixed for CSP), visually the most generic screens in the app |
| Processing/System (Super Admin) | `/processing`, `/system` | super-admin | Acceptable with refinement |

No route is "functionally incomplete" or "duplicate" in this audit — the gap end-to-end is visual
density/hierarchy/responsiveness, not missing functionality, matching Mohammed's own framing
("functionally strong but visually too basic").

## Implementation order (as specified)

1. Shared tokens + theme activation + core components
2. Shells/navigation (all 3, responsive)
3–15. Module-by-module polish pass, in the specified order, reusing the same components
16. Global responsive/accessibility sweep + Chrome-DevTools-equivalent regression pass
17. Android: translate final tokens into the Compose theme (already token-driven, per-module sync)

## Verification standard going forward

Every batch: `pnpm typecheck && pnpm lint && pnpm test` + the `puppeteer-core` audit script
(`scratchpad/devtools/audit.js`) at 1440/1024/390px, light + dark, checking for console/CSP errors
and an actual screenshot — not a curl status code. This replaces this session's earlier
curl-only verification standard, which the CSP bug above proved insufficient.
