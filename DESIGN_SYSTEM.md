# Design System

Single source of truth for PropertyVault's visual language across every platform (`apps/admin`→
`apps/web`, native iOS, native Android). See `DESIGN_REVIEW.md` for the comparison against
`reference/propview-screenshots/` and the two Envato UI-kit references this version was produced
against, and for the role-specific experience/platform-strategy decisions that inform it.

## Direction

Calm, refined, "private vault" feel rather than a generic admin-dashboard, fintech-bright, or
consumer-marketplace look (`DESIGN_REVIEW.md` §1: PropertyVault manages property portfolios, it
does not sell or rent listings). Document/paper motifs over illustration; a single restrained
accent used only for primary actions and links, never "one blue for everything" the way PropView
does it. Status is always colour + icon + label together, never colour alone.

All colours, type scale, spacing and radii below are still **placeholders** — centralised in
`packages/ui/src/tokens.ts` specifically so they can be swapped for final brand values without
touching component code.

## Tokens (`packages/ui/src/tokens.ts` — already implemented)

- **Colour**: semantic names only in component code. Light: near-black ink (`#12151A`) on warm
  off-white (`#FBFAF7`); accent `#2F5D50` (deep verdigris). Dark: `#F2F1ED` on true near-black
  `#14161A` (not a lightened-gray "inverted light mode" — validated against the Envato dark-theme
  kit's own near-black execution, `DESIGN_REVIEW.md` §5), accent `#5B9683`. 7 status colours
  (`statusPaid/Unpaid/Overdue/NeedsReview/Processing/Disputed/Void`), each with a light and dark
  value, plus `danger`.
- **Typography**: system font per platform (SF Pro / Roboto / Inter-equivalent web stack), a
  6-step scale — `display 32/40/700`, `title 24/32/700`, `heading 18/24/600`, `body 15/22/400`,
  `caption 13/18/400`, `micro 11/14/500` (size/line-height/weight).
- **Spacing**: 4px base unit, scale `[0,4,8,12,16,24,32,48,64]`.
- **Radii**: `sm 4, md 8, lg 12, xl 16, pill 999` — cards use `md`/`lg`, pills/badges use `pill`.
- **Elevation**: `none 0, low 1, medium 2, high 4` — usage rules in §"Cards" below.
- **Motion**: durations `fast 120, base 200, slow 320` ms; ease-out for entrances, ease-in for
  exits.
- **Icon sizing**: `sm 16, md 20, lg 24, xl 32`.

## Status colour + non-colour signal

`packages/ui/src/statusPresentation.ts` implements this for `BillStatus` today
(`BILL_STATUS_PRESENTATION`) — every status badge pairs a `colorToken` with an `icon` and a
`label`. **Needs extending**: the org/multi-tenancy pivot (M4 onward) introduced many more status
enums with no presentation map yet — `RentScheduleStatus`, `LeaseStatus`, `ApplicationStatus`,
`MaintenanceStatus`, `InvoiceStatus`, `ExpenseStatus`, `OrganizationStatus`,
`OrganizationSubscription`'s status. Each new list/detail UI built from here on should add its
status enum to `statusPresentation.ts` rather than inventing an inline colour map per component —
`SubscriptionsTable.tsx`/`CustomersTable.tsx` (M19) currently do the latter and should be migrated
when next touched, not as a standalone refactor.

| Status | Icon | Label |
| --- | --- | --- |
| paid | check | Paid |
| unpaid | dot | Unpaid |
| overdue | alert-triangle | Overdue |
| needs_review | eye | Needs review |
| processing | spinner | Processing |
| disputed | flag | Disputed |
| void | slash | Void |

## Buttons

Three variants, one size scale, never colour-only for meaning:

- **Primary** — solid `accent` fill, `accentContrast` text. One per view/section at most (matches
  the existing accent-restraint direction — never PropView's "every action is the same blue"
  pattern, `DESIGN_REVIEW.md` §2).
- **Secondary** — `border` outline, `textPrimary` text, transparent fill. Default for anything not
  the single primary action.
- **Destructive** — `danger` fill or outline (outline by default, solid only behind a confirm
  step) — always paired with confirming copy naming what will happen, matching
  `PROPVIEW_SCREENSHOT_AUDIT.md` §5's observed pattern of destructive actions "always paired with
  a warning caption."
- Sizes: `sm` (32px height, `caption` text), `md` (40px height, `body` text, the default),
  `lg` (48px height, `heading` text — reserved for a page's single hero CTA, e.g. an empty state's
  "+ Add property").
- Disabled state: 40% opacity, no hover/focus treatment, `cursor: not-allowed`.

## Cards

- **Elevation**: `low` (1) for cards resting directly on the page surface (the common case —
  KPI cards, list-row cards); `medium` (2) for cards that float above other content (dropdown
  panels, the AI Assistant drawer); `high` (4) reserved for modals only. Never stack elevation
  levels arbitrarily — each level has exactly one meaning.
- **KPI/stat card** (`AdminMetricCard`, extend per `DESIGN_REVIEW.md` §2): icon badge (top-left,
  `iconSize.md`, tinted circular background using the metric's own semantic colour token — e.g. an
  overdue-rent KPI uses `statusOverdue` at low opacity as its badge background) + bold `title`-scale
  number + `caption`-scale label + `micro`-scale muted subtext/hint. 1-column (mobile) → 2–4 column
  (desktop) reflow, `spacing[6]` (24px) gutter.
- **List-row card** (property/lease/tenant/ticket row): left-aligned icon or avatar, primary line
  (`body`, semibold), secondary line (`caption`, `textSecondary`), trailing status badge and/or
  chevron. This is the shape a "populated" PropView table would likely have taken had the
  reference account not been empty (`PROPVIEW_SCREENSHOT_AUDIT.md` §6 flags populated layouts as
  unconfirmed) — treated as a reasoned default, not evidenced, and revisit if it doesn't hold up
  once real data exists.
- **Explainer card** ("How it works", reused from PropView per `DESIGN_REVIEW.md` §2): `surface`
  background one step lighter/darker than the page background, no border, `body`-scale text,
  2–3 sentences max. Used directly beneath an empty state or a rules-engine-generated feed (e.g.
  Portfolio Intelligence) to disclose *how* the content was produced — required, not optional,
  wherever `AI_ARCHITECTURE.md` §2's "nothing is estimated or made up" guarantee needs a visible
  home.

## Tables

`AdminDataTable` (TanStack Table wrapper, generic, already implemented) is the one table
primitive — every list view uses it, never a bespoke `<table>`. Rules:

- Column headers: `caption`-scale, `textSecondary`, no background fill.
- Row hover: `surfaceRaised` background shift only — no border/shadow change (avoid layout shift).
- Status columns always render via `statusPresentation.ts` (colour+icon+label), never a bare
  coloured pill of text alone.
- Numeric columns (currency, counts) right-align; text columns left-align.
- Empty state: `emptyMessage` prop renders the Empty State pattern below, inline within the table
  container, not a separate page state.
- Pagination: cursor-based only, matching `API_SPEC.md` §0 — "Load more" or a `next_cursor`-driven
  "next page" control, never numbered pages (offset pagination isn't exposed by any API this UI
  calls).

## Forms

- Standard text/number/date inputs: `border` outline, `md` radius, `body`-scale text,
  `caption`-scale label above the field (never a placeholder-as-label).
- **Segmented control** for closed enums with ≤5 options (`MaintenancePriority`,
  `RentFrequency`), reused from PropView (`DESIGN_REVIEW.md` §2) — a row of pill-shaped toggle
  buttons, one always selected, rather than a `<select>`.
- **Character counters** on any free-text field with a DB-enforced max length (e.g.
  `maintenance_tickets.description`, `expenses.category`) — `micro`-scale, right-aligned under the
  field, turns `statusOverdue`-tinted past ~90% of the limit.
- Validation errors render inline under the field (`statusOverdue` text, `caption` scale),
  sourced directly from the API's `field_errors` response shape (`API_SPEC.md` §0) — never a
  separate client-side validation message that could disagree with the server's.
- Multi-step forms (e.g. a future property-creation wizard): a fixed step indicator at the top,
  never a modal — matches the desktop-SaaS "large workspace, not a phone-sized dialog" direction
  in the Platform Strategy section below.

## Modals

- Reserved for a single confirm/cancel decision or a short (≤1 screen) focused task — never a
  full record's create/edit form (those get their own page or a docked side panel on desktop).
- `elevation.high`, `xl` radius, `surfaceRaised` background, a scrim (`textPrimary` at ~40%
  opacity) behind it.
- Destructive-action modals always restate the target by name ("Archive **Acme Property
  Management**?") and require the primary button to say the action, never a bare "Confirm" — matches
  `PERMISSIONS.md`/`API_SPEC.md`'s general discipline against ambiguous confirmations.

## Alerts / toasts

- Inline (form-level, page-level banner) vs. transient (toast, auto-dismiss) — inline for anything
  the user needs to act on or that persists past the triggering action (e.g. "This organization is
  suspended"), toast for a fire-and-forget confirmation ("Credit issued").
- Same colour+icon+label discipline as status badges — an alert's colour is never the only signal
  of its severity.
- The Super Admin support-session banner (`SUPER_ADMIN.md` §6.4 — persistent, non-dismissible,
  names the target org and session start time) is a distinct, permanent variant of the inline
  banner, not a toast — it must survive navigation for the whole session, which a toast cannot do.
  **Not yet built** (`TECHNICAL_DEBT_REGISTER.md` TD-25 — no client-org-facing UI exists yet for a
  support session to apply to).

## Empty states

Reused from PropView (`DESIGN_REVIEW.md` §2), modernized: circular icon badge (tinted with the
context's semantic colour, not a decorative pastel) → bold `heading`-scale "No [X] yet" → one-line
`caption`-scale `textSecondary` explanation → a single primary-button CTA where an action exists
(omit the CTA entirely for read-only/derived views, e.g. an insights feed with nothing to add
manually). Warm, direct copy — no marketing tone.

## Loading states

- Skeleton screens (shape-matched placeholder blocks at `low` elevation, subtle shimmer at
  `motionDuration.base`) for anything that takes >300ms and has a known layout — KPI cards, table
  rows, detail pages. Never a bare spinner for content that has a predictable shape.
- A centered spinner is reserved for actions with no predictable result shape — form submission,
  the AI Assistant's "thinking" state between a sent message and its reply.

## Error states

- Field-level: inline under the input (see Forms).
- Action-level (a mutation failed): inline banner alert at the top of the affected section, not a
  toast — the user needs to see it long enough to retry, and it shouldn't auto-dismiss out from
  under an unresolved failure.
- Page-level (data failed to load): replaces the content area with an icon + `heading`-scale
  message + a "Retry" button — never a blank page or a raw error string. `error.tsx`/
  `global-error.tsx` (Next.js error boundaries, already present in `apps/admin/app/`) are the
  page-level implementation point.

## Responsive rules

- **Desktop-first for the web/PWA surface** (`apps/admin`→`apps/web`), matching the existing
  `DESIGN_SYSTEM.md` decision and `DESIGN_REVIEW.md` §4 — this is the one platform with left
  navigation, a top toolbar, large data tables, and multi-column dashboards; it is not a stretched
  phone layout. Breakpoints: `sm 640px, md 1024px, lg 1280px, xl 1536px` — **real bug found and
  fixed 2026-08-02** (`UI_REDESIGN_PLAN.md`): this scale was documented but never actually
  configured in `tailwind.config.ts`, which silently used Tailwind's stock `md 768/lg 1024` scale
  instead for every `md:`/`lg:` utility ever written. Now a real `screens` override.
- Sidebar: persistent and expanded ≥`lg`; collapses to icon-only ≥`md`; becomes an overlay drawer
  below `md`. **Implemented 2026-08-02** (`UI_REDESIGN_PLAN.md`): `components/shell/AppShell.tsx`,
  one shared shell for all three route groups — confirmed broken by screenshot before this pass
  (a 390px capture showed the full sidebar never collapsing at all, squeezing every KPI card into
  ~1-word-wide columns). Section groups (dashboard nav: Portfolio/Leasing/Operations/Finance/
  Communications) are now grouped with labels; independent per-section collapse/expand
  (`DESIGN_REVIEW.md` §2's further flag) is still future work — this groups them, it doesn't yet
  let a section fold away.
- Tables: horizontal scroll within their own container below `lg`, never the page itself
  scrolling horizontally.
- Native apps (iOS/Android) are designed independently per `DESIGN_REVIEW.md` §4, following each
  platform's own HIG/Material 3 layout conventions — not a shared responsive breakpoint system
  with the web surface.

## Component foundation — current implementation status

`packages/ui/src/` (tokens, status presentation) is the cross-platform token source; each
platform implements its own component idiom against it (no shared RN/web visual component
library — an existing, unchanged decision, see `DECISIONS.md`).

Implemented in `apps/admin/components/ui/`: `AdminDataTable`, `AdminMetricCard`,
`HealthStatusIndicator`, `MiniBarChart`, `MiniLineChart` — all generic, reused as-is per
`SUPER_ADMIN.md` §0 and confirmed still fit-for-purpose in this review. **Not yet implemented for
admin**: `EmptyState`, `SkeletonState`, `ErrorState`, button variants, segmented control, modal,
toast/alert — these exist for `apps/mobile` (`apps/mobile/src/design/components/`) in RN form but
have no admin/web equivalent yet. Building these is this design phase's first implementation
target, per `DESIGN_REVIEW.md` §6.

## Light/dark, accessibility

- Every token has a light and dark value; both apps respect system theme by default, with an
  explicit System/Light/Dark override (PropView pattern, reused). **Implemented 2026-08-02**
  (`UI_REDESIGN_PLAN.md`): `next-themes` (`attribute="class"`, matching `tailwind.config.ts`'s
  existing `darkMode: 'class'` strategy exactly) + `components/ui/ThemeToggle.tsx` — real bug
  found and fixed in the same pass: dark mode had never actually activated anywhere before this,
  since nothing in the codebase ever set the `.dark` class every `dark:` utility across every
  module was written against.
- Minimum contrast target: WCAG AA (4.5:1 body text) — must be re-verified once final brand
  colours are chosen, unchanged from the original decision.
