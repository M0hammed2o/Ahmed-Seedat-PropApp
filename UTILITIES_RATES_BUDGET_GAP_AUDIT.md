# Utilities / Rates / Budget — Evidence-Based Gap Audit

CURRENT HEAD: `f217bc45816f9d4981bfafa2a9d02660740b1e4` (branch `main`, equal to `origin/main`)
WORKING TREE: clean (`git status` — nothing to commit) at the start and end of this audit; `apps/ios` and `supabase/migrations` untouched throughout (no writes were made anywhere — this is a read-only audit)
AUDIT ONLY: YES — no code, schema, or UI was modified to produce this report.

`docs/` does not exist in this repository. The established documentation convention is top-level `*.md` files at the repo root (`DATABASE.md`, `ACCOUNTING.md`, `API_SPEC.md`, etc.), so this report is placed there, matching that convention.

---

## EXECUTIVE SUMMARY

| Question | Answer |
|---|---|
| Do Utilities exist today? | **NO** — no meter, meter-reading, or consumption-history concept exists anywhere in the schema, API, web, or Android. "Water"/"Electricity" exist only as document-category labels and as free-text line-item descriptions on levy statements — never as a metered, billable concept. |
| Do Rates exist today? | **PARTIAL** — `properties.municipal_account_number` (an account reference, not an amount) exists and is exposed in the property form. A recurring monthly municipal-rates *charge* does not exist as a first-class concept; the closest real mechanism is the general-purpose `expenses` table (free-text `category`) and the `levy_statements`/`levy_statement_line_items` OCR-extraction pipeline, which explicitly never posts to accounting. |
| Do Property Expenses exist today? | **YES** — a real, fully-wired `expenses` table (property_id required, unit_id optional, vendor_id, category, amount, evidence document, reference number, invoice date, notes) with a complete web create/list/detail UI and a documented `record` (post-to-ledger) action. This is genuinely a property-operating-expense system, distinct from tenant invoices. |
| Do Budgets exist today? | **NO** — zero hits for "budget" anywhere in `supabase/migrations`, `apps/admin`, `apps/android`, or `packages` outside of two unrelated English-language uses of the word "budget" (rate-limit "attempt budget"). No budget table, type, field, or UI of any kind. |
| Does Budget vs Actual exist today? | **NO** — the "actual" half exists (`expenses`, `owner_statements.expenses_total`, the Reports page's Income vs Expense Trend); there is nothing to compare it against. |
| Do Meter Readings exist today? | **NO** — confirmed absent from schema, API, web, and Android. `PRODUCT_SPEC.md` references a "Meter Reading" tenant-portal screen as part of the target native-app information architecture (sourced from `PROPVIEW_SCREENSHOT_AUDIT.md`, a competitor screenshot audit), but it is unbuilt everywhere. |
| Does Utility History exist today? | **NO** — no readings exist to have history of. |
| Does Leak/Anomaly Detection exist today? | **NO** — no threshold/rule engine, no anomaly table, no leak concept anywhere. |
| Does Owner Payment Review exist today? | **YES** — a complete, real, end-to-end feature: `payment_reports` table + `confirm_payment_report()`/`reject_payment_report()` RPCs, `/api/v1/payment-reports/{id}/confirm|reject` API routes, a web review page (`/accounting/payment-reports`), and an Android review screen (`PaymentReviewListScreen`, reachable via More → Payment review). It is explicitly an **acknowledgement** layer, not the ledger itself (see §7). |
| Does Paid/Unpaid Tenant status exist today? | **YES, at the data/web level; PARTIAL on Android** — `rent_schedules.status` (`pending/invoiced/paid/overdue/partial`) is the single authoritative source, filterable on the web `/accounting/rent-due` page. Android has no equivalent per-tenant paid/unpaid list screen, though the aggregate figures (`confirmedPaid`/`outstanding`/`awaitingConfirmation`) are already available to it via `owner_property_summaries`. |

---

## GAP MATRIX

| Capability | Database | Backend/API | Web | Android | Status | Evidence |
|---|---|---|---|---|---|---|
| Property rates | `properties.municipal_account_number` (text, an account ref, not a rate amount) | `PATCH/POST /api/v1/properties` accepts `municipalAccountNumber` | `PropertyForm.tsx` has a Municipal Account Number field | Not present | **PARTIAL** | `supabase/migrations/20260101000006_properties.sql:13`; `apps/admin/components/properties/PropertyForm.tsx:40,228-229`; `apps/admin/app/api/v1/properties/route.ts:187` |
| Unit rates | None | None | None | None | **MISSING** | Exhaustive grep of `units`-related migrations/API/UI found no rate/levy/charge field on units beyond rent itself |
| Municipal rates (recurring charge amount) | None (only the account-number reference above) | None | None | None | **MISSING** | No `municipal_rate`/`rates_amount` column anywhere; confirmed by full-repo grep for `rates_` and `municipal_rate` |
| Levies | `levy_statements` + `levy_statement_line_items` (OCR-assisted, per-property) | `GET/POST .../properties/[id]/levy-statements` | `LevyStatementsPanel.tsx`, rendered inside `PropertyManagementPanel.tsx` on the property page | Not present | **PARTIAL** | `supabase/migrations/20260101000097_property_compliance_and_levy_statements.sql:717-812`; `apps/admin/app/api/v1/properties/[id]/levy-statements/route.ts`; `apps/admin/components/properties/LevyStatementsPanel.tsx`. Explicitly documented as never posting to accounting (see migration comment lines 806-811) |
| Water utilities | Only a `document_categories` row (`'water'`) and free-text levy line-item descriptions (e.g. "unit water") | None | Document upload can be tagged "Water" category | Not present | **PARTIAL** (document tagging only — no metering/billing concept) | `supabase/migrations/20260101000007_document_categories.sql:36`; `supabase/migrations/20260101000097...sql:771` (comment citing "unit water"/"common water" as real levy-statement line-item text) |
| Electricity utilities | Same as water | None | Same as water | Not present | **PARTIAL** | Same citations as Water |
| Meter readings | None | None | None | None | **MISSING** | Zero matches for "meter" as a device/reading concept across all 162 migrations, all `apps/admin` and `apps/android` source (all raw "meter" hits were substrings inside unrelated words like "parameter"/"perimeter") |
| Utility consumption history | None | None | None | None | **MISSING** | Depends entirely on meter readings, which don't exist |
| Property expenses | `expenses` table (property_id, unit_id, vendor_id, category, amount, status, document_id, journal_entry_id, reference_number, invoice_date, notes) | `GET/POST /api/v1/expenses`, `POST /api/v1/expenses/{id}/record`, `POST /api/v1/expenses/{id}/attach-evidence` | Full list/new/detail pages under `/accounting/expenses` | Not present | **PASS** (web+API+DB); **MISSING** (Android) | `supabase/migrations/20260101000037_accounting_subledgers.sql:219-250`; `supabase/migrations/20260101000145_expense_evidence_and_fields.sql`; `apps/admin/app/api/v1/expenses/route.ts`; `apps/admin/components/accounting/ExpenseForm.tsx` |
| Expense invoice upload | `expenses.document_id` → `documents` | `attach-evidence` route; `uploadEvidenceDocument` reuses the 'receipt' document category | `ExpenseEvidenceUpload.tsx`, wired into `ExpenseForm.tsx` | Not present | **PASS** (web); **MISSING** (Android) | `apps/admin/components/accounting/ExpenseForm.tsx:37,76-92`; `apps/admin/app/api/v1/expenses/[id]/attach-evidence/route.ts` |
| Expense receipt upload | Same document infra as above, plus a dedicated `'receipt'` document category | Same | Same | Not present | **PASS** (web); **MISSING** (Android) | Same as above; `supabase/migrations/20260101000007_document_categories.sql:45` |
| Recurring expenses | None — every `expenses` row is a one-off entry | None | None (no "make recurring" control) | Not present | **MISSING** | No `recurring`/`recurrence`/`is_recurring` column on `expenses`; confirmed by full column list in 20260101000037 + 20260101000145 |
| Property monthly budget | None | None | None | None | **MISSING** | Zero real hits for "budget" repo-wide (see Executive Summary) |
| Unit budget | None | None | None | None | **MISSING** | Same |
| Category budget | None | None | None | None | **MISSING** | Same |
| Budget vs actual | Actuals exist (`expenses`, `owner_statements.expenses_total`); no budget/plan side | Reports page computes actual income/expense only | `/reports` "Income vs Expense Trend" panel (actuals only) | Not present | **MISSING** | `apps/admin/app/(dashboard)/reports/page.tsx:29-35,226-265` (comment explicitly: "a V1-appropriate approximation of 'income vs expense,' not a general ledger report") |
| Overspend alerts | None | None | None | None | **MISSING** | No alert/threshold/rule table found in any migration |
| Utility anomaly alerts | None | None | None | None | **MISSING** | Depends on meter readings, which don't exist |
| Leak detection | None | None | None | None | **MISSING** | Same |
| Paid tenants | `rent_schedules.status = 'paid'` is authoritative | `GET /api/v1/rent-schedules?status=paid` (same param the web page uses) | `/accounting/rent-due` — filterable table incl. a "Paid" filter chip + metric card | No equivalent screen; only the aggregate `confirmedPaid` figure via `owner_property_summaries` | **PASS** (web); **PARTIAL** (Android — aggregate only, no list) | `supabase/migrations/20260101000030_leases.sql:6` (status enum); `apps/admin/app/(dashboard)/accounting/rent-due/page.tsx:37-75`; `apps/android/.../data/ownersummary/OwnerSummary.kt` |
| Unpaid tenants | `rent_schedules.status in ('pending','overdue','partial')` | Same route, `?status=overdue` etc. | Same page, "Overdue"/"Pending" filters | Same partial-aggregate situation (`outstanding` figure only) | **PASS** (web); **PARTIAL** (Android) | Same citations as "Paid tenants" |
| Payment review queue | `payment_reports` table, `status enum('reported','confirmed','rejected')` | `GET /api/v1/payment-reports` | `/accounting/payment-reports` page | `PaymentReviewListScreen` (via More → Payment review) | **PASS** | `supabase/migrations/20260101000106_payment_reports_phone_verification_reminders.sql:22-53`; `apps/admin/app/(dashboard)/accounting/payment-reports/page.tsx`; `apps/android/.../ui/paymentreview/PaymentReviewViewModel.kt`; wired in `apps/android/.../navigation/OwnerRootScreen.kt:174-175,193` |
| Confirm payment | `confirm_payment_report()` RPC (accountant+ only, idempotent) | `POST /api/v1/payment-reports/{id}/confirm` | Confirm button on the review page | `PaymentReviewViewModel.confirm()` | **PASS** | `...20260101000106...sql:120-166`; `apps/android/.../data/network/WebApi.kt:63-64` |
| Reject payment | `reject_payment_report()` RPC, requires a non-blank reason, idempotent | `POST /api/v1/payment-reports/{id}/reject` | Reject button + reason prompt | `PaymentReviewViewModel.reject()` | **PASS** | `...20260101000106...sql:175-216`; `apps/android/.../ui/paymentreview/PaymentReviewViewModel.kt:77-91` |
| Payment audit history | **Explicitly NOT written by the confirm/reject RPCs themselves** (`SECURITY INVOKER`, no `audit_events` insert privilege); the calling API route is documented as responsible for writing `audit_events` after a successful RPC call | Not independently verified in this pass which route handler actually performs that write | Not verified | Not verified | **PARTIAL — unverified** | `...20260101000106...sql:158-164,213-214` (migration's own comments state the intended design; this audit did not trace the actual `apps/admin/app/api/v1/payment-reports/[id]/confirm/route.ts` handler to confirm the write happens). **This is a genuine open item — flag for direct code inspection before relying on it.** |

---

## EXISTING REUSABLE COMPONENTS

All evidence-backed, all confirmed present and wired (not speculative):

- **`documents` + `extraction_jobs`** — a generic, org-scoped document store with a real OCR/extraction pipeline (`extraction_jobs.provider_name`, `attempt`, `status`, idempotent per document+attempt). Already used for levy-statement extraction (`ocr_heuristic` vs `manual` source, with a `confidence` score) and can plausibly be pointed at municipal/water/electricity invoices with no schema change. (`supabase/migrations/20260101000011_extraction_jobs_and_results.sql`; `20260101000097...sql:765-782`)
- **`document_categories`** — already has first-class `'water'`, `'electricity'`, `'rates_and_taxes'`, `'levies'`, `'proof_of_payment'`, `'receipt'` categories seeded. A municipal-rates or utility-bill upload can be tagged correctly *today* with zero new taxonomy work. (`supabase/migrations/20260101000007_document_categories.sql:36-45`)
- **`expenses` + `ExpenseForm.tsx`** — property/unit-scoped, vendor-linked, evidence-attached, free-text-categorized operating-expense capture, already fully wired end-to-end on web. The free-text `category` field means "Water", "Electricity", or "Municipal Rates" can be entered as expense categories *today*, manually, with no new column. (`supabase/migrations/20260101000037_accounting_subledgers.sql:219-250`; `apps/admin/components/accounting/ExpenseForm.tsx`)
- **`vendors`** — a real supplier/vendor directory (`trade_category`, `is_external`, `rating_avg`, `status`) already linkable from `expenses.vendor_id`. A municipality or utility provider can be modeled as a vendor today. (`supabase/migrations/20260101000034_maintenance_and_inspections.sql:17-31`)
- **`levy_statements` / `levy_statement_line_items`** — a structured, OCR-assisted statement-ingestion pipeline (opening/closing balance, per-line `category`/`amount`/`line_type`, confidence score) that already handles the exact shape of a recurring municipal/body-corporate bill. Its own migration comment explicitly flags that converting a reviewed line item into a real expense/ledger entry was deliberately left out of scope — this is the most direct existing foundation for a rates/utility-bill feature, and reusing/extending it (rather than inventing a parallel system) is the lowest-risk path. (`supabase/migrations/20260101000097...sql:717-812`)
- **`owner_statements`** — a period-based owner financial summary (`rent_collected`, `expenses_total`, `management_fee`, `net_payable`) already computed and stored per owner per period. This is structurally the closest existing thing to the target Owner Home "Net Position" metric — it just isn't broken down by expense category (utilities vs rates vs other) and isn't currently surfaced on the Android Owner Home. (`supabase/migrations/20260101000037...sql:253-270`)
- **`owner_property_summaries` + `runOwnerMonthlySummaryJob()`** — a server-computed, already-Android-consumed monthly rollup (`expectedRent`, `confirmedPaid`, `outstanding`, `awaitingConfirmation`, `openMaintenanceCount`, `upcomingLeaseExpiryCount`). This is real, live, server-authoritative data already flowing to a mobile screen (`OwnerSummaryListScreen`, "Monthly summary"). (`supabase/migrations/20260101000107_owner_monthly_summary.sql`; `apps/android/.../data/ownersummary/PostgrestOwnerSummaryRepository.kt`; `apps/android/.../ui/ownersummary/OwnerSummaryListScreen.kt:24-27`)
- **`payment_reports` + confirm/reject RPCs + Android `PaymentReviewViewModel`** — the entire owner payment-review loop (report → review queue → confirm/reject) is real, tested-in-production-shape, and already has a mobile UI. This is the strongest existing foundation in the whole audit and needs no new data model.
- **Notification engine** — not directly audited in this pass, but `AuthEventStore`-adjacent infrastructure and the existing `notifications`/`announcements` tables (seen in passing) are a plausible delivery channel for future overspend/anomaly alerts, once such a rule engine exists. (Not independently verified this pass — noted as a lead, not a citation.)

---

## NEW DATA MODEL LIKELY REQUIRED

Not created. Recommended only, as concepts to evaluate — final naming/shape is a design decision, not this audit's:

- **`utility_meters`** — one row per water/electricity meter, scoped to a property or a specific unit, with a meter identifier/serial and a type (water/electricity). Nothing today models a meter as a persistent, addressable thing.
- **`utility_readings`** — opening/closing (or point-in-time) readings against a `utility_meters` row, a billing period, a consumption value, and whether the reading is estimated vs actual. This is the load-bearing gap: without readings, there is no history, no anomaly baseline, no leak signal.
- **A decision on `utility_bills` vs. extending `expenses`/`levy_statement_line_items`** — rather than a wholly new billing table, evaluate first whether a water/electricity bill is better modeled as (a) an `expenses` row with `category='Water'` (already possible today, zero schema change, but loses structured tariff/consumption linkage), or (b) a new line-item type on the existing `levy_statement_line_items` pattern (reuses the OCR pipeline, but that table's own migration comment states line items deliberately never post to accounting — that boundary would need to be revisited). Both existing mechanisms are close enough that a genuinely new `utility_bills` table should only be built if neither extension is judged sufficient.
- **`property_budgets` / `budget_lines`** — a monthly or annual planned-amount table, likely per property (and optionally per unit/category), that a variance calculation can subtract `expenses`/`owner_statements` actuals against. No existing table is close enough to extend — this is a genuinely new concept.
- **`utility_alert_rules`** (or similar) — only meaningful once `utility_readings` exists; a threshold/percentage-increase rule table, evaluated against consecutive readings. Do not build before the readings table exists to evaluate against.

Do not assume these exact names — they are working labels for the audit, not a schema proposal.

---

## OWNER MOBILE IMPACT

Not implemented — identified only, based on what the evidence above shows is missing on Android specifically (recall: web is materially ahead of Android for every capability in this domain except payment review, which Android already matches).

- **Expense capture** (Android has zero equivalent of `ExpenseForm.tsx` — property/unit/vendor/category/amount/evidence entry does not exist as a mobile screen today)
- **Utility bill capture** — blocked on the same new-data-model decision above; do not build a mobile capture screen before the underlying model exists
- **Paid/unpaid tenant list** — Android's `TenantsListScreen` is a plain directory with no status; the `owner_property_summaries` aggregate (`confirmedPaid`/`outstanding`) is already fetched for the "Monthly summary" screen but not the per-tenant list — extending `TenantsListScreen`/`TenantDetailScreen` to surface `rent_schedules.status` per tenant is the natural next step and needs no new backend work
- **Home financial summary richer than rent** — Owner Home currently shows rent-only figures (Collected/Billed/Outstanding, confirmed against real `DashboardScreen.kt` from the prior fidelity pass); `owner_statements.expenses_total`/`net_payable` exist server-side today and could extend the KPI panel without new schema, once a decision is made on whether to expose org-wide owner-statement totals on the dashboard (they are currently period/owner-scoped statement rows, not a rolling "this month so far" figure — verify the aggregation semantics before wiring this)
- **Budget dashboard / utility history / alerts** — cannot be built on Android (or anywhere) until the underlying data models exist; listed here only for completeness of the eventual IA, not as near-term work

---

## WEB IMPACT

The web app is already the stronger platform for nearly everything in this domain and should stay the setup/admin surface:

- **Property/unit setup** — already the only place `municipalAccountNumber` can be set; any new rates/levy/utility setup fields belong here first (property/unit forms), not on mobile
- **Meter setup** — if `utility_meters` is built, meter creation (identifier, type, property/unit assignment) is inherently a low-frequency admin task and belongs on web
- **Budget setup** — same reasoning; entering a monthly/annual budget per property/category is an admin task, not a field task
- **Bulk expense management** — `ExpensesTable.tsx`/`ExpensesFilterClient.tsx` already exist as the bulk-view surface; extending these for utility/rates-specific filtering is cheaper than building equivalent bulk tooling on Android
- **Historical reporting** — the `/reports` page's existing month-bucketed chart infrastructure (`MiniBarChart`/`MiniLineChart`) is the natural home for utility-consumption-history and budget-vs-actual charts once the underlying data exists — reuse it rather than building new chart infra
- **Levy-statement review** — `LevyStatementsPanel.tsx` (OCR review/correction) is inherently a desk task and should stay web-only

---

## RECOMMENDED V1 BUILD ORDER

Derived from the dependency chain actually found in the repo (not a generic template):

1. **Business-rule decision first** (see Blockers below) — specifically, how a reviewed levy-statement line item or a categorized expense is supposed to become an authoritative "utility/rates cost" for budget-vs-actual purposes. This gates almost everything else and is not a coding task.
2. **Data model**: `utility_meters` + `utility_readings` (the load-bearing gap — nothing downstream is possible without these existing), plus the `property_budgets`/`budget_lines` tables. Decide the `utility_bills` question above before writing this migration.
3. **Backend/API**: CRUD for meters/readings, budget CRUD, and a budget-vs-actual computation endpoint (likely reusing the existing month-bucketing pattern from `/reports/page.tsx`).
4. **Web setup/admin**: meter setup on the property/unit page, budget setup on the property page, reading entry (even a simple manual-entry form is a valid V1 — do not require OCR/anomaly detection to ship a V1).
5. **Web reporting**: utility-consumption-history chart, budget-vs-actual panel on `/reports`, reusing existing chart components.
6. **Android owner workflows**: paid/unpaid tenant list (no new backend needed — do this independently and earlier if desired, since it only requires wiring existing `rent_schedules.status`/`owner_property_summaries` data into `TenantsListScreen`), then expense capture, then utility-reading capture once the web-proven data model exists.
7. **Alerts**: overspend and utility-anomaly rules, only once real reading/budget history exists to evaluate against (a threshold rule with no historical baseline is not meaningfully testable).
8. **OCR automation for utility/rates bills**: extend the existing `levy_statements` extraction pipeline (reuse `extraction_jobs`) to municipal/water/electricity invoices, once the business-rule decision in step 1 defines what a reviewed line item should become.

Paid/unpaid tenant status on Android (item 6's first half) has no dependency on anything else in this list and can be built immediately if the owner wants a quick win while the utilities/budget data model is being designed.

---

## BLOCKERS / QUESTIONS

Only genuine business-rule questions this audit could not answer from the code:

1. **When a levy-statement line item or a categorized expense represents a water/electricity/rates charge, should it automatically post to the accounting ledger (`journal_entries`) and/or become part of a per-property "utilities spend" figure, or must it always remain a manually-reviewed, separately-tracked figure?** The current `levy_statement_line_items` design deliberately never posts to accounting (per its own migration comment) because "the correct accounting treatment (owner expense vs recoverable tenant charge) is not determinable from the statement alone." This is a real business decision (does the owner absorb the cost, or recover it from the tenant?) that code cannot resolve.
2. **Should utility costs that are recoverable from tenants (e.g. metered water/electricity billed back to a tenant) flow through the existing tenant-invoice/`rent_schedules` machinery, or remain purely an owner-side expense?** This determines whether `utility_readings`/`utility_bills` needs a tenant-facing billing hook or stays entirely on the owner/expense side.
3. **What counts as "the" property/unit budget period** — calendar month only, or does the owner need annual budgets with monthly sub-allocations? This shapes the `property_budgets`/`budget_lines` schema and cannot be inferred from any existing table (no analogous period-shape decision exists elsewhere in the schema to copy).
4. **Does the payment-review confirm/reject action actually write an `audit_events` row today?** The migration's own comment says the *API route* is responsible for this (the RPC deliberately does not, since it runs `SECURITY INVOKER` and `audit_events` has no client insert policy). This audit did not trace the specific route handler to confirm the write happens — this is close to a routine implementation question rather than a business-rule one, but it is flagged because relying on "payment audit history exists" without that direct trace would be a guess, not evidence.

---

## FINAL VERDICT

| Domain | Verdict |
|---|---|
| **UTILITIES** | **MISSING** — no meter/reading/consumption concept exists anywhere; water/electricity exist only as document-tagging labels. Core module needs to be built. |
| **RATES** | **MISSING** — a recurring rates/levy *charge* concept does not exist; only an account-number reference field and a document-category label exist. The `levy_statements` OCR pipeline is the closest reusable foundation but explicitly stops short of becoming a rates/expense figure. |
| **EXPENSES** | **EXISTING** — mostly already built. A real, fully-wired, evidence-attached, vendor-linked property-operating-expense system exists end-to-end on web (DB+API+UI); the only material gap is Android (no mobile capture screen) and the lack of a fixed water/electricity/rates category taxonomy (currently free text). |
| **BUDGETS** | **MISSING** — zero foundation of any kind. Core module needs to be built from scratch. |
| **PAYMENT REVIEW** | **EXISTING** — mostly already built, on every platform (DB, API, web, and Android), including confirm/reject with a required rejection reason and idempotent RPCs. The one open item is unverified audit-trail writing (see Blockers §4), not the feature itself. |
