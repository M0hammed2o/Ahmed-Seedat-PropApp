# Design Review — PropertyVault Design System v2

Produced after `TASKS.md` M19 (Super Admin) shipped and verified, per Mohammed's instruction to
pause new UI implementation and do a complete design review before continuing. Compares
`reference/propview-screenshots/` (138 images, fully catalogued in `PROPVIEW_SCREENSHOT_AUDIT.md`)
against two Envato "Property Mobile App UI Kit" listing pages Mohammed provided as visual
inspiration, against the current `DESIGN_SYSTEM.md`/`packages/ui/src/tokens.ts` (Phase-1-era,
written for the single-owner PropVault product, before the org/multi-tenant/role-based pivot).

**Verified directly**: re-opened `IMG_7990.JPG` (Insights/Portfolio Intelligence empty state) and
`IMG_8023.JPG` (Maintenance Board KPIs) from the reference folder to confirm
`PROPVIEW_SCREENSHOT_AUDIT.md` §5's extraction against real pixels, not just the text audit —
both matched exactly (sidebar grouping, breadcrumb, KPI card anatomy, empty-state formula,
explainer-card placement). The two Envato images are taken as given (pasted directly into this
conversation, not files in the repo).

---

## 1. What PropertyVault is not

Both Envato kits ("Property Mobile App UI Kit" by uicube — dark theme — and by an unnamed
Sketch-format seller — light/navy theme) are **consumer real-estate marketplace apps**: browse
listings, filter by price/size/amenities/rating, view a property gallery, "Rent a House" / "Buy
House" entry points, heart/favorite icons, star ratings on listings. This is the exact thing
`PRODUCT_SPEC.md`/`ARCHITECTURE.md` already establish PropertyVault is **not** — a portfolio
_management_ platform for people who already own/manage/lease/administer real property, not a
platform for finding a property to move into. Every marketplace-specific pattern in both kits
(browse-by-category grids, "Recommended"/"Best Offers" carousels, price-per-listing hero cards,
star-rating-driven filtering, "Book Now" as a primary CTA) is explicitly **out of scope** —
including PropView's own Listings Studio/Enquiries/Sales & Auctions modules, which exist in
PropView but sit outside PropertyVault's confirmed V1 scope (`RETAIN_REFACTOR_REBUILD_MATRIX.md`).

What both kits are legitimate inspiration **for**, narrowly: visual execution of image-forward
cards, dark-theme contrast handling, filter-panel layout (segmented pills, range sliders, amenity
chips), and typographic weight contrast between a price/number and its label — component-level
craft, not information architecture or user journeys.

## 2. Reuse / modernize / simplify / improve, by pattern

| Pattern (source)                                                                                                                                   | Verdict                                                              | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty-state formula: pastel circular icon badge → bold headline → one-line gray subtext → CTA (PropView, confirmed live in `IMG_7990.JPG`)         | **Reuse**, modernize the icon-badge treatment                        | The formula itself (icon, headline, subtext, CTA) is sound UX and already partially implemented (`apps/admin`'s `AdminDataTable emptyMessage`, `packages/ui` has no dedicated `EmptyState` yet for admin). Modernize by using a single accent tint per context (info/success/warning) rather than PropView's undifferentiated pastel-purple-for-everything — ties empty states into the existing `statusPaid`/`statusOverdue`/etc. semantic palette instead of a decorative one.                                                                                                                                                                                       |
| KPI/stat card anatomy: icon badge (top-left) + bold number + label + muted subtext (PropView, confirmed live in `IMG_8023.JPG`)                    | **Reuse**, already close                                             | `AdminMetricCard` (`apps/admin/components/ui/`) already implements this shape (`{label, value, hint}`). Extend, don't replace: add the icon-badge slot PropView uses to color-differentiate KPI _type_ at a glance (open/in-progress/completed/overdue each got a different pastel tint in `IMG_8023.JPG`) — `AdminMetricCard` today is icon-less.                                                                                                                                                                                                                                                                                                                     |
| "How it works" / explainer cards under empty states (PropView)                                                                                     | **Reuse as-is**                                                      | Directly supports `AI_ARCHITECTURE.md` §2's "nothing is estimated or made up" transparency requirement for Portfolio Intelligence — this exact card, this exact placement, is the right home for that disclaimer in the rebuilt UI.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| "More Tools" / feature-row disclosure list (icon + bold title + gray description + chevron) (PropView)                                             | **Reuse**, rename concept                                            | Good pattern for progressive disclosure of secondary actions (e.g. an organization detail page's activate/suspend/archive/credits actions, `TASKS.md` M19's still-unwired buttons). Not currently implemented anywhere in `apps/admin`.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Filter-pill row under KPIs (PropView); segmented filter panel with range slider + amenity chips (Envato uicube kit)                                | **Reuse pill row, borrow the segmented-control craft**               | PropView's rounded active-pill filter row is simple and works for the small, fixed filter sets PropertyVault actually has (status, role, plan). The Envato kit's more elaborate filter _panel_ (slide-out, range slider, multi-select chips, "Apply" button) is worth borrowing as a pattern for the one place PropertyVault has genuinely multi-dimensional filtering — Documents/Audit Log search (`API_SPEC.md` §0's `q=`/`filter[]` convention) — not for simple single-status list filters, which would be over-built by comparison.                                                                                                                              |
| Persistent grouped sidebar + breadcrumb + top bar (search, theme toggle, bell, avatar) (PropView)                                                  | **Reuse structure, modernize density**                               | This is the correct desktop-SaaS shell shape and already exists in `apps/admin/app/(dashboard)/layout.tsx` in simplified form (no breadcrumb, no global search yet). Modernize: PropView's sidebar is single-density or all sections always expanded — for `apps/admin`'s now-much-larger nav (M4–M19 added Portfolio/Leasing/Operations/Finance/AI/Communications/Super-Admin groups, more than PropView's own landlord console), collapsible section groups are needed or the sidebar becomes unusably long. This is a real, new requirement PropView's screenshots don't show a solution for (its own nav is long uncollapsed too — not a pattern to copy blindly). |
| Segmented-button groups for short enums instead of dropdowns (e.g. Priority: Low/Med/High/Urgent) (PropView)                                       | **Reuse**                                                            | Better affordance than a dropdown for ≤5 options, matches `MAINTENANCE_PRIORITIES`/`RENT_SCHEDULE_STATUSES`-shaped enums throughout the schema. Not yet implemented in `apps/admin`'s forms (none exist yet beyond simple text/number inputs).                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Character counters + quick-fill suggestion chips on free-text fields (PropView, Maintenance submission)                                            | **Reuse**                                                            | Directly applicable to `expenses.category`, `maintenance_tickets.summary`/`description`, AI Assistant free-text input.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Image-forward property cards with price badge, gallery grid, star rating (both Envato kits)                                                        | **Do not reuse as primary pattern; borrow shadow/radius craft only** | PropertyVault's properties are managed assets, not browsable listings — a property "card" in PropertyVault's UI needs occupancy/rent-status/maintenance-open-count at a glance, not a hero photo and a price badge. The Envato kits' _elevation and corner-radius execution_ (soft multi-layer shadow, 12–16px radius, image bleeding to the card edge) is worth adopting for `DocumentCard`/`PropertyCard`'s visual polish specifically — not the marketplace content model.                                                                                                                                                                                          |
| Dark navy/near-black theme execution with high-contrast white text and saturated accent (Envato kits)                                              | **Reference only, do not adopt the specific palette**                | Confirms dark mode can look premium rather than "inverted light mode" — useful validation that the _approach_ (true near-black surface, not dark-gray-tinted-light-surface) is right, which `packages/ui/src/tokens.ts`'s `colorDark` already does (`#14161A` surface, not a lightened gray). Do not copy the kits' actual blue accent — `PROPVIEW_SCREENSHOT_AUDIT.md` §5's own "do not copy exact color hex values" rule extends to these kits too; PropertyVault's identity must be its own.                                                                                                                                                                        |
| Solid-blue-for-everything primary action color, pastel circular icon backgrounds everywhere (PropView)                                             | **Simplify, don't reuse wholesale**                                  | PropView uses one blue for every primary action regardless of context (create, save, confirm, navigate). `packages/ui`'s existing restrained-accent + semantic-status-color approach (`statusPaid`/`statusOverdue`/etc., never color-alone per the existing accessibility rule) is already a _better_, more disciplined system than PropView's — keep it, don't regress toward "one blue for everything."                                                                                                                                                                                                                                                              |
| "AI Assistant" FAB → chat drawer, stages changes for confirmation (PropView)                                                                       | **Reuse pattern, already architecturally matched**                   | `AI_ARCHITECTURE.md` §1 already specifies this exact interaction (stage → confirm, never auto-apply) and M18 already built the API layer for it. The FAB-to-drawer visual pattern is the right home for it once a UI is built — not yet implemented anywhere in `apps/admin`.                                                                                                                                                                                                                                                                                                                                                                                          |
| Marketplace-specific modules: Listings Studio, Enquiries/Leads, Articles (CMS), Sales & Auctions, Virtual Tours, Neighbourhood Insights (PropView) | **Do not reuse — out of scope**                                      | Confirmed out of V1 scope per `RETAIN_REFACTOR_REBUILD_MATRIX.md`; no design work spent on these.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## 3. Role-specific experiences

Per `PERMISSIONS.md`'s role model and the actual API surface built through M19, four distinct
experiences — never one screen set with visibility toggles, matching the multi-tenancy model's own
"never merge into one permission set" rule applied to UI too:

### Owner (client-org `principal`/`manager`, and the `owners` self-access identity)

- **Portfolio**: property list with occupancy/rent-status-at-a-glance (KPI-card-per-property or a
  dense table, not marketplace-style photo cards — see §2), unit-level drill-down.
- **Income/Expenses**: reads `journal_lines` filtered by owner (`ACCOUNTING.md`), owner statements
  (`owner_statements` table, M14 part 3, not yet built).
- **Payments**: rent-schedule status board (PropView's "Rent Due" KPI-card pattern, reused).
- **Lease expiry**: reuses the same `lease_expiring` insight type M18's Portfolio Intelligence
  already computes (`portfolio_insights` where `insight_type = 'lease_expiring'`) — the owner
  dashboard's "leases expiring soon" widget should read this feed directly, not recompute it.
- **Maintenance**: read + approve (owner-visible subset of `maintenance_tickets`).
- **Notifications**: `notifications`/`announcements` (M15, built).

### Tenant (`tenants` self-access identity, no org-staff role)

- **Lease**: read-only, `leases`/`lease_tenants` (M10, built — no tenant-facing read policy exists
  yet on those tables per `TECHNICAL_DEBT_REGISTER.md` TD-21-adjacent gap; needs a tenant-self RLS
  branch, same shape as `tenant_can_view_property_announcement()` from M15).
- **Payments**: `rent_schedules` read + "log a payment" (external EFT, matches PropView's own
  "payments are external, logged/reminded in-app" model, not processed in-app — confirmed
  consistent with `ACCOUNTING.md`'s bank-reconciliation design, not a new decision).
- **Documents**: tenant-visible subset (needs the same tenant-self RLS branch as leases).
- **Maintenance**: submit (own tickets) + status.
- **Meter readings**: optional, evidenced in PropView but not yet in `DATABASE.md` — flag as an
  open schema gap if this is confirmed in scope, not built speculatively.
- **Notices**: `announcements` (M15, built, tenant-visibility already correct).
- **Profile**: own account settings.

### Staff (client-org `agent`/`accountant`/`viewer`)

- **Assigned work**: maintenance tickets assigned to them, inspections scheduled.
- **Inspections**: `inspections`/`inspection_items` (M13, built).
- **Applications**: screening pipeline (M9/M10, built).
- **Maintenance**: full board (role-gated writes per `PERMISSIONS.md` §2 already enforced at the
  API/RLS layer — the UI only needs to reflect what the role can already do, never invent its own
  permission logic per `API_SPEC.md` §11's "never only in the UI" rule).
- **Property information**: read access scoped by org membership (already RLS-enforced).

### Super Admin (`platform_admin_users`, M19, built this session)

- **Client Directory**: `listPlatformOrganizations()` (M19).
- **Active Organizations / Subscription Management**: organization detail + plan/credits actions
  (M19's API layer built; buttons not yet wired to UI — this design phase's job).
- **Revenue Dashboard**: `computePlatformMetrics()` (M19, live-computed — see `TECHNICAL_DEBT_REGISTER.md` TD-24 for why not snapshot-backed yet).
- **Usage Statistics**: `GET .../usage` (M19).
- **Health Monitoring**: `system/page.tsx`'s existing "not yet connected" pattern, kept per
  `SUPER_ADMIN.md` §0's own recommendation.

## 4. Platform strategy — an honest scoping note before design tokens are spent on all three

`ROADMAP.md`/`TASKS.md` sequence native iOS (M21) and Android (M22) after web (M20).
`MOBILE_ARCHITECTURE_DECISION.md` (already on file, written before this session) is unambiguous:
**zero native code exists anywhere in this repository** — no `.xcodeproj`, no `.xcworkspace`, no
`build.gradle`, no `AndroidManifest.xml`, confirmed by that document's own repo-wide search. It
explicitly gates starting native screens on "the backend/data-model rebuild... far enough along
that native screens have real APIs to call against" — which is now true (M4–M19 shipped).

The environment this session runs in is Windows (`win32`), with no Xcode (which requires macOS —
not a tooling gap that can be worked around, an operating-system requirement) and no confirmed
Android SDK/Gradle toolchain. Concretely, this means:

- **PWA (desktop web, `apps/admin`→`apps/web`)**: real, buildable, testable code — `next build`,
  `pnpm typecheck`, `pnpm lint`, pgTAP all already run and verify in this environment. Design
  system implementation continues here for real, same as M4–M19.
- **iOS (SwiftUI)**: this document, and a follow-up screen-by-screen spec, can be written as real
  design/architecture documentation extending `MOBILE_ARCHITECTURE_DECISION.md`. Actual `.swift`
  source files can be _written as text_, but cannot be compiled, run, or verified in this
  environment — there is no Xcode. Writing hundreds of unverifiable Swift files would violate this
  project's own evidence rule (never claim a result without tool output) if presented as working
  code rather than an unverified draft.
- **Android (Kotlin/Compose)**: same constraint in practice — no confirmed Gradle/Android SDK
  toolchain in this sandbox to compile or run anything, even though Android tooling
  (unlike Xcode) is at least theoretically OS-portable.

**This is flagged as a genuine scoping question, not a blocker to the rest of this phase.** The
design review, the design system, and role-specific specs below apply to all three platforms
identically at the specification level (tokens, component anatomy, interaction patterns). What's
paused pending Mohammed's direction is _whether_ to produce unverified native source as a
best-effort starting point for a future native-toolchain session, or to keep this phase's native
output at the specification/screen-inventory level only (extending
`MOBILE_ARCHITECTURE_DECISION.md`) until real native tooling is available to verify against.

## 5. Theme

Light is default, matching `DESIGN_SYSTEM.md`'s existing (correct, unchanged) decision. Dark mode
uses the same token contract (`colorDark` in `packages/ui/src/tokens.ts`, already implemented) —
the Envato dark-theme kit's near-black-not-gray surface approach validates the existing
`colorDark.surface` choice; no palette change made on the strength of that alone (`PROPVIEW_SCREENSHOT_AUDIT.md`
§5's "do not copy exact hex values" applies to both reference sources equally).

## 6. What changes next

`DESIGN_SYSTEM.md` rewritten in the same change as this review to add the missing component-level
specs (buttons, cards, tables, forms, modals, alerts, empty/loading/error states, responsive
rules) `packages/ui/src/tokens.ts` has tokens for but no documented usage rules. Implementation
continues incrementally on `apps/admin` (the only platform with real, verifiable code) — reusing
existing APIs, not rebuilding working backend code, per Mohammed's explicit instruction.
