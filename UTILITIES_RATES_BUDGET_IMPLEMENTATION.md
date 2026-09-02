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

## Owner Home mobile — what shipped and what didn't

**Shipped (Android):**
- "Rent status" screen (`ui/rentstatus/`) — property picker, month, status filter chips (All/Paid/
  Partial/Unpaid/Overdue), per-tenant expected/paid/outstanding, reachable via More → Rent status.
  Server-authoritative from `rent_schedules.status` via the new `tenant-payment-status` endpoint — never
  inferred from `payment_reports`.
- `FinancialSummaryRepository`/`WebApi.getFinancialSummary()` — the client plumbing for the one-call
  owner financial summary endpoint exists and is wired into Hilt DI (mock + real), ready for the Owner
  Home dashboard extension below.

**Not shipped this pass (backend ready, UI deferred):** the Owner Home dashboard extension (Utilities /
Rates & Levies / Other Expenses / Total Expenses / Budget / Net Position sections from the target
hierarchy) was not wired into `DashboardScreen.kt`. Reason: `owner_financial_summary()` and
`budget_vs_actual()` are **property-scoped** (matching how the existing web Reports/Rent-due pages already
work), but Owner Home is portfolio-wide (the existing rent figures there already come from the
portfolio-wide `owner_property_summaries` table/job). Reconciling a property-scoped endpoint with a
portfolio-wide Home screen correctly — either by extending `owner_property_summaries`'s generating job
(`runOwnerMonthlySummaryJob()`, `lib/systemJobs.ts`) to also compute utilities/rates/budget totals, or by
adding a genuinely new org-wide aggregation RPC — is real design work that was not rushed under this
pass's remaining time. Doing it superficially (e.g. summing per-property calls client-side, or silently
showing only the first property's figures) would have produced a dashboard that is subtly wrong for any
owner with more than one property, which is worse than not shipping it. This is the most-visible actual
gap left by this pass — see "Deferred / Next" below.

**Not shipped (backend ready via existing reusable expense infrastructure, no new mobile UI):** Add
Expense, Utility Capture (meter/reading entry), Budget View, Utility History screens (§9 C-F). All the
underlying API routes exist and are tested (`/recurring-costs`, `/utility-settings`, `/utility-meters`,
`/utility-meters/:id/readings`, `/budget`, `/budget/annual`). Building the mobile capture/browse UI for
each was not completed within this pass's scope — genuinely deferred, not attempted-and-broken.

## Web — what shipped

- Property detail page, new "Finances" tab (`PropertyFinancesPanel.tsx`): property-level rates & taxes
  and levy (current amount, save), water/electricity responsibility (dropdown, save), this month's
  budget (planned/actual/remaining/% used, save).
- Unit-level rates/levy/responsibility setup (§5B) was **not** built this pass — the API
  (`recurring-costs`/`utility-settings` both already accept an optional `unitId`) supports it; only the
  unit-detail-page UI panel is missing. Documented here, not silently absent.

## Deferred / next (explicitly out of scope this pass, per the task's own §20 and the reasoning above)

- Owner Home (Android) financial dashboard extension — needs the portfolio-wide aggregation design
  decision above before it can be built correctly.
- Unit-level web setup UI for rates/levy/responsibility.
- Android: Add Expense, Utility Capture, Budget View, Utility History screens.
- Alerts wired into the existing Needs Attention/Notifications/Activity architecture (budget-exceeded
  and unusual-usage alerts are computed and available via API today; nothing pushes them into a
  notification yet).
- Shared-meter tenant allocation, tariff engines, IoT/smart-meter integration, automated municipal
  scraping, advanced/seasonal anomaly detection, tenant utility rebilling, iOS — all explicitly deferred
  per the task's own instructions, not attempted.
