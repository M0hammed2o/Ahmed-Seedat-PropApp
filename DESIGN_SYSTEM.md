# Design System

## Direction

Calm, refined, "private vault" feel rather than a generic admin-dashboard or fintech-bright look. Property-oriented without literal house icons everywhere — the visual language leans on document/paper motifs (subtle card elevation, precise corner radii, a restrained accent colour used only for status and primary actions) rather than illustration.

All colours, type scale, spacing and radii below are **placeholders** — centralised in `packages/ui/tokens.ts` specifically so they can be swapped for final brand values without touching component code (per the branding-centralisation requirement in the brief).

## Tokens (`packages/ui/tokens.ts`)

- **Colour**: semantic names only in component code (`color.surface`, `color.textPrimary`, `color.statusPaid`, `color.statusOverdue`, ...), each with a light and dark value. Placeholder palette: near-black ink (`#12151A`) on warm off-white (`#FBFAF7`) for light; inverted, desaturated for dark. A single restrained accent (`#2F5D50`, deep verdigris) for primary actions/links — deliberately not the generic SaaS blue/purple. Status colours are never the sole signal (see below).
- **Typography**: one type family per platform (system font — SF Pro / Roboto — to keep native feel and avoid custom-font licensing/perf overhead in Phase 1), a 6-step scale (`display, title, heading, body, caption, micro`), consistent line-height ratios.
- **Spacing**: 4px base unit, scale `[0,4,8,12,16,24,32,48,64]`.
- **Radii**: `[4,8,12,16,999]` — deliberately not "everything is a huge rounded rectangle"; cards use the smaller end, pills/badges use `999`.
- **Shadows/elevation**: 3 levels, subtle (no heavy drop shadows), platform-appropriate (RN `elevation`/shadow props on mobile, `box-shadow` on web).
- **Motion**: durations `[120,200,320]` ms, standard ease-out for entrances, ease-in for exits — used for sheet/modal transitions and skeleton shimmer.
- **Icon sizing**: `[16,20,24,32]`.

## Status colour + non-colour signal

Every status badge (`PaymentStatusBadge`) pairs colour with an icon and a text label (never colour alone), per the brief's accessibility requirement:

| Status       | Icon           | Label        |
| ------------ | -------------- | ------------ |
| paid         | check          | Paid         |
| unpaid       | dot            | Unpaid       |
| overdue      | alert-triangle | Overdue      |
| needs_review | eye            | Needs review |
| processing   | spinner        | Processing   |
| disputed     | flag           | Disputed     |
| void         | slash          | Void         |

## Component foundation

Mobile (`apps/mobile/src/design/`) and admin (`apps/admin/components/ui/` via a heavily customised shadcn/ui base) each implement the same token contract in their platform's idiom — there is no shared visual component library across RN and web (a documented decision, see DECISIONS.md), but both read from the one `packages/ui/tokens.ts` source of truth so the two surfaces stay visually consistent.

Phase 1 implements initial versions of: `PropertyCard`, `DocumentCard`, `PaymentStatusBadge`, `EmptyState`, `SkeletonState`, `ErrorState`, `BiometricLockScreen`, `ConfirmationSheet` (mobile); `AdminMetricCard`, `AdminDataTable`, `HealthStatusIndicator` (admin). Remaining components listed in the brief (`MonthlyChecklist`, `UploadProgress`, `SearchFilterSheet`, `SecureDocumentPreview`, `SubscriptionPaywall`, `AdminAuditDrawer`) are scaffolded with props/types defined but a minimal implementation, since their full content depends on Phase 2 features (real upload, real OCR, real matching) — tracked in TODO.md rather than built as empty shells with no purpose.

## Light/dark, accessibility, responsiveness

- Every token has a light and dark value; both apps respect system theme by default.
- Minimum contrast target: WCAG AA (4.5:1 body text) — placeholder palette above was chosen to satisfy this, but must be re-verified once final brand colours are chosen.
- Admin is desktop-first responsive (per brief); mobile uses safe-area-aware layouts (`react-native-safe-area-context`) throughout.
