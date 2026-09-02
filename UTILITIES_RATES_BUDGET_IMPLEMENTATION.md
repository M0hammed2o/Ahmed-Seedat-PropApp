# Utilities / Rates / Levies / Budgets — V1 Implementation

Implements the gaps identified in `UTILITIES_RATES_BUDGET_GAP_AUDIT.md`. Read that document first for
the evidence this implementation is built on. This document records what was actually built, the
accounting boundaries it respects, and what remains deliberately deferred.

## Authoritative tables — one financial truth per concept

| Concept | Authoritative table/function | Never use instead |
|---|---|---|
| Owner operating expense (actual money spent) | `expenses` (unchanged, migration 20260101000037) | `payment_reports`, `levy_statement_line_items` (never auto-posts) |
| Recurring rates/levy *configuration* (expected monthly amount) | `recurring_property_costs` (migration 163) | — this is planning data, it never itself posts to `expenses` |
| Utility responsibility (who pays) | `utility_responsibility_settings` (migration 163) | — |
| Utility meters/readings | `utility_meters` / `utility_readings` (migration 163) | — |
| Property budget (planned) | `property_budgets` / `budget_category_lines` (migration 164) | — |
| Budget actual | Computed live from `expenses` via `budget_vs_actual()` (migration 164/166) | Never stored — always derived |
| Tenant rent due / paid status | `rent_schedules.status` (unchanged) | `payment_reports.status` (a claim, not the ledger) |
| Real payment allocation | `invoice_payments` via `record_invoice_payment()` (unchanged) | — |
| Tenant payment *claim* (before owner review) | `payment_reports` (unchanged) | — |

**The single rule that matters most:** `payment_reports.status = 'confirmed'` means the owner has
*acknowledged* a claim. It is not proof the ledger moved. Migration 165 makes `confirm_payment_report()`
allocate through `record_invoice_payment()` when it safely can (see below) — but the check for "is this
tenant paid" must always read `rent_schedules.status`, never `payment_reports.status`.

## Payment confirmation — traced, then fixed

Traced before touching anything: `confirm_payment_report()` (migration 106) and its API route
(`apps/admin/app/api/v1/payment-reports/[id]/confirm/route.ts`) only ever flipped
`payment_reports.status` and sent a WhatsApp notification. They never touched
`invoice_payments`/`rent_schedules`. Audit logging, however, was already correctly implemented (both
confirm and reject routes call `writeAuditEvent()` with the service-role client) — that part of the
prior audit's "unverified" note is resolved: it works.

Migration 165 fixes the ledger gap. `confirm_payment_report()` now has three outcomes on first
confirmation:

1. **`rent_schedule_id` set + a matching issued invoice exists** → allocates for real through
   `record_invoice_payment()` (the same single entry point every other payment path already uses).
   `rent_schedules.status` recomputes via the same shared helper that path already used.
   `payment_reports.invoice_payment_id` links to the new row for traceability.
2. **`rent_schedule_id` is null** (an ad-hoc/advance payment not tied to one schedule row) →
   acknowledgement-only, unchanged from the pre-165 behaviour. This is a genuine ambiguity (which
   invoice would it apply to?), not a shortcut.
3. **`rent_schedule_id` set but no invoice issued yet** → confirmation is *refused*
   (`error_code: invoice_not_issued`), never silently downgraded to acknowledgement-only. The owner
   issues the invoice first (an existing, separate action), then confirms.

Re-confirming an already-confirmed report is idempotent and never re-allocates (verified by pgTAP:
`supabase/tests/payment_report_ledger_allocation.test.sql`, scenario "duplicate confirmation does not
double-allocate").

Cash vs EFT are not distinguished by this fix — both flow through the same `record_invoice_payment()`
call with `payment_reports.payment_method` passed straight through (its enum `eft`/`cash`/`other` is a
strict subset of `invoice_payments`' own method list). A dedicated "cash collector" identity field was
**not** added: `payment_reports.reported_by_user_id` already *is* the collector whenever
`reported_by_tenant = false` (the existing staff-records-cash-on-tenant's-behalf path), which covers the
real-world case this system supports. A tenant self-reporting cash they handed to someone has no
separate "who did I pay" field — `reported_by` (the tenant) and `reviewed_by` (whoever confirms) remain
the audit trail for that case. Documented here as a deliberate V1 scope decision, not an oversight.

## A real security fix found while building this

`budget_vs_actual()` (as first written in migration 164) and `owner_financial_summary()` (migration 166)
are both `SECURITY DEFINER` — necessary to aggregate across tables with their own narrower RLS — but
`budget_vs_actual()` initially had no explicit authorization check of its own, meaning any authenticated
caller could pass any `property_id` and read another organization's budget and expense totals. Found and
fixed in the same migration set (before anything shipped) by adding the identical
`has_org_role(org_id, 'viewer')` check `owner_financial_summary()` already had. Covered by pgTAP
(`supabase/tests/owner_financial_summary.test.sql`, both cross-org `throws_ok` assertions).

## Responsibility modes

`owner_paid`, `tenant_paid_direct`, `tenant_prepaid`, `included_in_rent`, `common_area_owner` — one
active row per (property or unit) × (water or electricity) in `utility_responsibility_settings`.
`common_area_owner` is rejected at the unit scope (a trigger + a table CHECK) — it is inherently
property-wide. Meters carry a denormalized copy of the responsibility mode at creation time
(`utility_meters.responsibility_mode`) for query convenience; it is not kept in sync automatically if
the setting later changes — a meter's physical existence and who currently pays for it are genuinely
independent facts that can drift (e.g. a unit re-let under new terms).

## Rates & levies — effective-dated, never overwritten

`recurring_property_costs`: one *current* row (`effective_to IS NULL`) per (property or unit) ×
(`rates_and_taxes` or `levy`), enforced by a partial unique index. Setting a new amount closes out the
old row (`effective_to = new effective_from - 1 day`) and inserts a new one — the old row's amount is
never edited in place, so a past period's expected cost never silently changes. Passing `amount = null`
retires the cost entirely (no bogus zero-amount placeholder row, per the approved business rule).

This is *configuration*, not a transaction — setting a levy amount does not itself create an `expenses`
row. Turning "R2,200/month levy is configured" into an actual posted expense for a given month is a
separate, explicit action (recording an expense with a matching category), deliberately not automated —
the correct accounting treatment for a given month (was it actually paid? does the amount match the
statement?) is not something configuration alone can answer safely.

## Budgets

`property_budgets` is keyed by `(property_id, month)` — one row per calendar month, always the source of
truth. There is no separate "annual budget" table. `distribute_annual_budget()` is a convenience that
inserts/updates 12 ordinary monthly rows summing exactly to the annual total (remainder-of-cents folded
into December) — the 12 rows remain independently editable afterward. Actuals are never stored; they are
computed live from `expenses` by `budget_vs_actual()` every time it's called.

Category matching (utilities vs rates & levies vs other) is case-insensitive free-text matching against a
canonical list (`'Water'`, `'Electricity'`, `'Rates and taxes'`, `'Levies'`, etc.) — `expenses.category`
is deliberately free text (an established convention in this schema, matching how
`levy_statement_line_items.category` already works), not a locked enum. **Known V1 limitation:** an
expense typed with a category name outside that list lands in "other" rather than "utilities"/"rates &
levies" until the category is corrected or the mapping list is extended. The web/Android expense forms
should offer the canonical strings as suggestions to minimize this.

Budget alerts (`approaching` at 80%, `exceeded` at 100%) are computed on read inside the
`financial-summary` API response, never persisted — this avoids both an alerts table and any "duplicate
alert" bug, since nothing is stored to duplicate.

## Utility anomaly wording (§4B)

Never "leak detected." The rule (implemented in
`apps/admin/app/api/v1/utility-meters/[id]/readings/route.ts`, `GET`) requires **both**:
- a ≥20% period-over-period increase, **and**
- an absolute increase of at least 200 L (water) or 20 kWh (electricity) — so a 1 L → 3 L "reading" (a
  200% increase on a meaningless base) never triggers a flag,

and at least 2 real reading periods must exist before anomaly detection runs at all. The UI-facing label
is `isUnusualUsage`; suggested copy is "Unusual water usage — increased by N% compared with last period."
No smart-meter/IoT integration, no seasonality baseline, no rolling-average comparison in V1 — flagged as
future scope in the gap audit and not attempted here.

## Meter reset/rollover — explicitly not handled

`record_utility_reading()` computes `consumption = current - previous` and stores it as-is, including
negative, if a reading is lower than the previous period's (a meter reset/rollover case). This is a
deliberate, documented deferral (per the audit's own "document it as future scope rather than
implementing unsafe assumptions" instruction) — not an oversight. A negative consumption value is a
data-quality signal the UI should surface, not something the database silently "corrects."

## Continuation pass (same day) — portfolio-wide Home, Android capture screens, web meter/budget management, alerts

The first pass above ended with the Android Home dashboard extension and several capture screens
deliberately deferred rather than rushed. This continuation pass closes those gaps.

### Portfolio-wide financial summary — the architecture decision

`owner_financial_summary()`/`budget_vs_actual()` (first pass) are **property-scoped**. Android Home is
**portfolio-wide**. Two options were on the table:

- **Extend `owner_property_summaries`** (the existing monthly-snapshot table/job Home's rent figures
  already came from) to also carry utility/rates/budget totals.
- **A new live, portfolio-wide RPC**, mirroring the property-scoped one but summed across every property
  in the org.

`owner_property_summaries` was traced (`getOrCreateOwnerMonthlySummary()`, `apps/admin/lib/ownerSummary.ts`)
and found to be a **frozen snapshot**: it returns the existing row for an owner+period if one exists and
never recomputes it — a new row is only created once per calendar month. That's correct for its actual
job (a WhatsApp-dispatched monthly report that must read the same weeks later as it did when sent), but
wrong for a screen an owner checks daily expecting today's real numbers. Extending it would have added
more stale figures alongside the rent figures Home was *already* showing stale (a pre-existing
characteristic, not something this pass introduced).

**Chosen: a new live RPC, `owner_portfolio_financial_summary(org_id, month)`** (migration 167),
computed fresh on every call, generalizing the property-scoped logic across every property in the org.
`DashboardViewModel` now calls this for **every** money figure on Home, including the rent hero card that
previously read the stale snapshot — this is a deliberate side effect: it resolves the "never mix
client-side and server-side definitions of monetary truth" rule by giving Home exactly one live source
for everything, and incidentally fixes the pre-existing rent-figure staleness as a consequence, not as
separate scope. `owner_property_summaries`/`OwnerSummaryListScreen` ("Monthly summary", still reachable
via More) are untouched — they keep their own distinct job (the WhatsApp report; maintenance/
lease-expiry counts this RPC doesn't compute, which is why `DashboardViewModel` still reads
`OwnerSummaryRepository` for those two KPI-strip figures specifically).

The same SECURITY DEFINER-without-its-own-auth-check bug pattern from the first pass's fix was checked
for here too — `owner_portfolio_financial_summary()` was written with the `has_org_role(org_id, 'viewer')`
check from the start (pgTAP-verified, `owner_portfolio_financial_summary.test.sql`, cross-org
`throws_ok`).

### Android — shipped this continuation pass

- **Owner Home dashboard extension**: Operating costs (Utilities/Rates & levies/Other/Total), Budget
  (planned/used/remaining/%, colour-coded at the 80%/100% thresholds), "Monthly net position" (rent
  collected − operating expenses, explicitly labelled not-profit with an inline explanation), and Needs
  Attention now merges the existing Portfolio Intelligence feed with a live "N payments awaiting
  confirmation" row sourced from the same financial-summary call (never a stale daily-job insight for
  something this time-sensitive).
- **Add Expense** (`ui/expenses/`) — property required, unit optional, category (suggested chips +
  free text, matching the free-text `expenses.category` model), amount, reference, date, notes, evidence
  (Camera/Gallery/File via the new shared `EvidenceUploadPicker`). Creates exactly one `expenses` row via
  the existing `POST /api/v1/expenses` — never a second/duplicate financial record. **Vendor selection
  was not built** — always sends `vendorId: null`; a full vendor search/create picker is real additional
  scope beyond an "optional" field, disclosed rather than faked.
- **Utility Capture** (`ui/utilities/`) — property → optional unit → water/electricity → meter → shows
  the previous reading and computed consumption from the server, current reading, date, optional bill
  evidence. Never computes "authoritative" consumption itself. A reading lower than the previous one is
  surfaced plainly ("this reading is lower than the previous one...") rather than silently corrected —
  meter reset/rollover stays out of scope, per the first pass's own documented limitation. An optional
  bill photo uploads and links as the *reading's* evidence (`utility_readings.document_id`) — it does
  **not** create an expense by itself (§6's own rule: only the owner knows the real amount from the
  bill; that still needs its own Add Expense entry).
- **Utility History** (`ui/utilities/`) — property/utility-type/meter pickers, a chronological list of
  periods with usage, previous usage, % change, and the server's `isUnusualUsage` flag rendered as
  "Unusual usage — consider reviewing for a possible leak or abnormal consumption," never "leak
  detected."
- **Budget View** (`ui/budget/`) — portfolio-wide by default (reuses the same live portfolio summary
  Home uses) or filtered to one property (the property-scoped endpoint). Planned/actual/remaining/% and
  a category breakdown (utilities/rates & levies/other). **Annual budget progress was not built** on
  Android — the monthly view is real and server-authoritative; annual is web-only this pass (see below).
- **Payment Review polish** — payment method shown as a clear label ("EFT / bank transfer"/"Cash"/
  "Other"), a "Reported by tenant" / "Recorded by staff" / "Cash collected by staff on the tenant's
  behalf" line (from the already-existing `reported_by_tenant` flag, newly threaded through the Android
  DTO/domain model — previously silently dropped), and the confirm button now reads "Confirm payment
  received." **No collector display name** was added — there is no reliable way to resolve
  `reported_by_user_id` to a safe display name (no profile-name field), so this stays a true/false
  distinction, never a fabricated name.
- **Rent Status polish** — a month selector (previous/next chevrons) was added; the screen previously
  showed the current month only with no way to look back.
- All new screens reachable from More → a new "Finances" section (Add expense / Utility reading /
  Utility history / Budget), alongside the first pass's Rent status entry. Bottom navigation
  (Home/Properties/Activity/More) is unchanged.
- Tests: `RentStatusViewModelTest` (4 cases, first pass) plus 3 new `DashboardViewModelTest` cases for
  `financialSummaryUiState` (portfolio call verified via `coVerify`, error surfacing, empty-org
  handling). Full suite 216/216 (was 209/209 at the very start of this work), 0 lint errors.

### Web — shipped this continuation pass

- **`UnitFinancesPanel.tsx`** (new, on the unit detail page) — the first pass's disclosed gap. Unit-level
  rates & taxes and levy (effective-dated, blank = not applicable), water/electricity responsibility
  (`common_area_owner` excluded from the picker — it's property-only, matching the DB CHECK
  constraint). Reuses the exact same `recurring-costs`/`utility-settings` API as the property panel,
  always passing this unit's id — no new backend surface.
- **`PropertyUtilityMetersPanel.tsx`** (new, on the property Finances tab) — this was the most
  load-bearing gap: the web app previously had **zero** utility-meter UI at all, meaning Android's own
  Utility Capture screen pointed owners to a web page that couldn't actually create one. Now: list
  meters, create one (utility type, unit or whole-property, meter number, responsibility, prepaid flag),
  and per-meter an expandable reading-entry form plus the last 6 periods of history with the anomaly
  flag. TENANT_PREPAID/TENANT_PAID_DIRECT are never forced to have a meter — the empty state explains
  why one may not be needed.
- **Annual budget UI** (added to `PropertyFinancesPanel.tsx`) — enter an annual total, distribute evenly
  across the selected year's 12 months (`POST .../budget/annual`), then edit any individual month
  inline afterward. The 12 `property_budgets` rows remain the only source of truth; nothing new is
  stored for "the annual total" itself, matching migration 164's own design.

### Alerts — wired into the existing Needs Attention / Portfolio Intelligence engine

`apps/admin/lib/portfolioIntelligence.ts` (the existing deterministic rules engine behind Android/web's
"Needs Attention," AI_ARCHITECTURE.md §2 — never an LLM) gained three new rule types, added to the
closed `PORTFOLIO_INSIGHT_TYPES` list rather than a competing alert system:

- `budget_exceeded` (urgent) / `budget_approaching` (warning, ≥80%) — evaluated per property+current
  month from `property_budgets` + `expenses`, reusing the same self-reconciling insert/update/
  auto-resolve mechanism every existing rule already uses (an insight for a budget that's no longer
  over/near threshold is auto-dismissed, never left stale).
- `unusual_utility_usage` (warning, never urgent — §4B's wording rule extends to severity) — evaluated
  per active meter, comparing the two most recent periods' consumption via the **same** shared
  `isUnusualUsage()`/`percentChange()` helper (`apps/admin/lib/utilityAnomaly.ts`, extracted in this
  pass) the reading-history API route uses, so the threshold logic is defined exactly once, not
  duplicated and liable to drift.

Payment-awaiting-confirmation was deliberately **not** added as a `portfolio_insights` row — this engine
runs as a periodic job (daily-ish freshness is fine for budget/usage trends), but a just-reported
payment should show up immediately. It's surfaced instead as a live row computed straight from the same
portfolio financial-summary call Home already makes every load (see "Android — shipped" above) — no
new database row, no staleness, no duplicate-alert risk since nothing is persisted to duplicate.

New tests: `apps/admin/lib/__tests__/portfolioIntelligence.test.ts` gained 4 real local-Supabase
integration cases (budget exceeded, budget approaching + auto-resolve, unusual usage fires with safe
wording, a large-percentage-on-a-tiny-base increase correctly does NOT fire) — 9/9 passing.

## Deferred / next (explicitly out of scope, per the task's own repeated "do not overbuild V1" instruction)

- **Vendor selection** in Add Expense (Android) — `vendorId` always null from mobile; a full vendor
  search/create picker is real additional scope, not built.
- **Annual budget progress on Android** — the web annual UI exists; Android's Budget View is monthly
  only this pass.
- **Category breakdown lines** (`budget_category_lines`) — the table and RLS exist (migration 164); no
  UI (web or Android) reads or writes them yet. The overall planned/actual/% figures shown everywhere
  are real; only the optional per-category budget split is unbuilt.
- **Meter reset/rollover handling** — unchanged from the first pass: a lower reading than the previous
  period is stored as-is (a negative consumption value), not silently "corrected."
- Shared-meter tenant allocation, tariff engines, IoT/smart-meter integration, automated municipal
  scraping, advanced/seasonal anomaly detection (rolling averages, real seasonality), tenant utility
  rebilling, iOS — all explicitly out of scope per the task's own instructions, not attempted.
