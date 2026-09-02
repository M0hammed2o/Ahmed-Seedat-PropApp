# Accounting Architecture

PropertyVault's accounting subsystem is a real double-entry ledger, not a bill/payment tracker (evidenced: PropView's Trial Balance module explicitly frames itself as double-entry — "every entry has an equal and opposite side" — with a "Balanced" health check, IMG_8045-46; confirmed decision: built in-house). Table shapes are in `DATABASE.md` §9; this document is the posting-rules and process design that makes those tables trustworthy.

## 1. Core principle: immutability

**No financial record is ever edited after posting.** Every correction — a wrong amount, a duplicate entry, a reversed payment — is made by posting a **reversing entry** (which exactly negates the original) and, where applicable, a **correcting entry** (which posts the right values). The original entry is untouched forever.

Why this is non-negotiable rather than a style preference: (1) it's what makes an audit trail actually auditable — an editable ledger can't prove it wasn't tampered with after the fact; (2) it's what the Trial Balance's "Balanced" check depends on — a ledger that's ever been directly edited can silently go out of balance in ways a running-balance view won't catch; (3) it's a hard requirement for trust-account handling (deposit money) under the regulatory model PropView evidences (RHA-equivalent rules) — trust accounting specifically requires this pattern in real-world practice, not just as good engineering hygiene.

Enforced at three layers: (1) the posting service is the only code path allowed to write `journal_entries`/`journal_lines` (`ARCHITECTURE.md`); (2) **`BEFORE UPDATE OR DELETE` triggers on both tables that unconditionally reject the operation** (`prevent_journal_entries_mutation()`/`prevent_journal_lines_mutation()`, `supabase/migrations/20260101000035`) — **corrected 2026-07-31**: this layer was originally specified as "RLS has no update/delete policy... for any role, including elevated ones," which is not actually a control against `service_role`, since that role has `BYPASSRLS = true` in this Supabase project (verified via `select rolbypassrls from pg_roles`) — RLS policies, present or absent, have no effect at all on a role that bypasses RLS entirely. A trigger fires regardless of RLS bypass or which role is writing, including the table owner, which is what "even elevated roles" actually requires. RLS's absence of an update/delete policy remains a real, secondary layer (it stops `authenticated`/`anon` before the trigger even needs to fire), just not the one doing the real work against a compromised service-role credential; (3) the posting service itself validates `SUM(debit) = SUM(credit)` before any insert and rejects the whole entry (not a partial post) if unbalanced. One narrow, schema-anticipated exception to "never edited": `journal_entries.reversed_by_entry_id` may be set exactly once, from `null` to a value, when a reversal is posted against it — the trigger allows only this single field-and-direction change and nothing else about a posted entry.

## 2. Chart of Accounts

Seeded per organization at creation from a system template (`chart_of_accounts.is_system = true` rows), covering the account types every org needs:

| Type      | Example accounts                                                                                                                                                        | Ledger class     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Asset     | Business Bank Account, Trust Bank Account, Accounts Receivable (rent owed)                                                                                              | business / trust |
| Liability | Accounts Payable (vendor bills owed), Tenant Deposits Held                                                                                                              | business / trust |
| Equity    | Owner Equity (per-owner sub-accounts via `journal_lines.owner_id`, not separate COA rows — keeps the chart of accounts stable regardless of how many owners an org has) | business         |
| Income    | Rent Income, Late Fee Income                                                                                                                                            | business         |
| Expense   | Maintenance Expense, Management Fee Expense, per-category expense accounts (matches `expenses.category`)                                                                | business         |

Orgs may add custom accounts (`is_system = false`) under the same type taxonomy; system accounts cannot be deleted, only deactivated (`is_active = false`), so historical postings against them always remain resolvable.

**Ledger class separation** (`business` / `trust` / `deposit`) is enforced at the account level, not just a UI filter: a posting service call that touches a trust-class account must originate from the trust/deposit workflow, never from general expense/rent posting — this is what keeps "business and trust accounts kept separate" (evidenced, IMG_8040) true at the data layer, not just the reporting layer.

## 3. Journal entry sources and posting rules

Every `journal_entries.source_type` maps to exactly one code path that's allowed to create entries of that type — no generic "post a journal entry" API exists; the posting service exposes typed operations:

| Source type    | Trigger                                                                                                                                                        | Lines posted                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `rent_invoice` | `rent_schedules` row reaches its due date (scheduled job) or is manually invoiced                                                                              | Dr. Accounts Receivable, Cr. Rent Income (per property/owner)                       |
| `payment`      | A `bank_transaction` is matched to a `rent_schedule` (via `calculateMatchScore`, confirmed by staff — never auto-confirmed) or a card-payment webhook confirms | Dr. Business/Trust Bank, Cr. Accounts Receivable                                    |
| `expense`      | An `expenses` row is marked `recorded`                                                                                                                         | Dr. [category] Expense, Cr. Accounts Payable (or Business Bank if paid immediately) |
| `deposit`      | A lease with a deposit goes `active`                                                                                                                           | Dr. Trust Bank, Cr. Tenant Deposits Held (trust-class accounts only)                |
| `owner_payout` | An `owner_statements` row is marked `paid`, matched to an outgoing `bank_transaction`                                                                          | Dr. Owner Equity (that owner), Cr. Business Bank                                    |
| `adjustment`   | Manual correction, always paired with...                                                                                                                       | ...a `reversal` entry                                                               |
| `reversal`     | References the entry it negates via `reversed_by_entry_id`                                                                                                     | Exact negation of the original entry's lines                                        |

Every entry requires `created_by` (a real user, never `null`) and is timestamped `posted_at` at the moment of insert — there is no "backdated" posting; `entry_date` (the accounting-period date) and `posted_at` (the real-world insert time) are deliberately separate columns so a late-entered March expense is correctly attributed to the March period without pretending it was entered in March.

## 4. Trust accounting & deposit interest

Deposits post to trust-class accounts only (§2). Interest accrual runs as a scheduled job (`last_interest_accrual_at` on `trust_ledgers`) applying `organizations.deposit_interest_pct` (RHA-equivalent rate the org configures — evidenced, IMG_8055) as an `interest_accrued` entry on each active trust ledger, posted as its own `journal_entries` row (`source_type = 'deposit'`), never silently folded into the balance.

**Release gate** (evidenced, IMG_8039: "no deduction without findings on a completed move-out inspection"): the posting service's deposit-release operation checks `inspections.status = 'completed'` for the associated lease before it will post a `deduction`/`refund` entry — this check lives in the service, not just a UI disable, so there's no API path that bypasses it.

**Implemented 2026-08-02** (`release_trust_deposit()`, migration `20260101000051`, `TASKS.md` M14 part 3): a lease's entire trust-ledger balance is settled in one call — Dr Tenant Deposits Held / Cr Trust Bank Account for the deduction+refund total (mirrors the deposit-received entry, reversed), plus Dr Business Bank Account / Cr a new system account `4900 Deposit Deduction Income` for any deduction portion specifically (the money that becomes the landlord's own funds). Additionally requires `inspections.inspection_type = 'move_out'` specifically (not any completed inspection) and settles the whole balance in one action — V1 does not support a partial/staged release. Interest accrual (`accrue_trust_interest()`, same migration) posts Dr a new system account `5950 Trust Interest Expense` / Cr Tenant Deposits Held for simple daily-prorated interest at `organizations.deposit_interest_pct` since the last accrual — an explicit accountant-triggered action in V1, not an unattended scheduled job (no cron infrastructure exists yet, `TECHNICAL_DEBT_REGISTER.md` TD-20/TD-22).

## 5. Owner Statements

Generated (not hand-entered) by an application service that:

1. Queries `journal_lines` for the given `owner_id`/period, split by `property_owners.ownership_pct` where a property has multiple owners.
2. Computes `rent_collected`, `expenses_total`, `management_fee`, `net_payable`.
3. Writes a durable `owner_statements` row — a **snapshot**, not a live view. Evidenced reasoning (IMG_8043): "A payout is only marked paid after an outgoing bank line matches the amount" — a statement already issued to an owner must not silently change if the underlying ledger is corrected later; the correction shows up as an adjustment in the _next_ period's statement instead, exactly mirroring the reversing-entry rule at the reporting layer.
4. Marks `status = 'paid'` only when `payout_matched_transaction_id` is set (bank reconciliation confirms the actual payout happened) — never on statement generation alone.

**Implemented 2026-08-02** (`generate_owner_statements()`/`issue_owner_statement()`/`confirm_owner_statement_payout()`, migration `20260101000052`, `TASKS.md` M14 part 3): `management_fee` is computed from a new simple flat `organizations.management_fee_pct`, the same "org-configured percentage" pattern already established by `deposit_interest_pct` — no tiered/per-property fee schedule is invented, none is documented. Generation is a batch operation across an org's whole portfolio for a period (`API_SPEC.md` §6's "month-scoped batch draft"), not one statement at a time.

## 6. Trial Balance

A live, computed report (not a stored table beyond the underlying `journal_lines`): `SUM(debit) - SUM(credit)` per account, filtered by `ledger_class` tab (Business / Trust / Deposits — evidenced, IMG_8046). The "Balanced" health check is `SUM(all debits) = SUM(all credits)` across the whole org's ledger — if this is ever false, it indicates a posting-service bug (an entry got through unbalanced) and should alert engineering, not just display a warning to the user, since it means the immutability/balance invariant in §1 was violated somewhere.

## 7. Tax Pack (SARS)

Computed on demand from `journal_lines`, filtered to the SA tax year (1 March–28 February, evidenced IMG_8047) and Income/Expense account types, grouped per-property and by expense category. Explicitly **not** a substitute for professional tax advice — carries forward the evidenced disclaimer verbatim in spirit: bond interest, wear-and-tear, and other allowances are not tracked or estimated by PropertyVault; income shown is payments actually received in the period, expenses come from the ledger, and the export states plainly that the user should confirm treatment with SARS or a registered tax practitioner before filing. This disclaimer is a product-integrity requirement, not boilerplate — PropertyVault must never imply it has computed a final, filing-ready tax liability.

**Implemented 2026-08-02** (`compute_tax_pack()`/`record_tax_pack_export()`, migration `20260101000053`, `TASKS.md` M14 part 3): "grouped by expense category" is grouped by `chart_of_accounts` account, since `record_expense()` already matches a category to a same-named account — the ledger's account taxonomy IS the category taxonomy, not a separate concept to compute. Export is CSV (a server-rendered PDF was deliberately not added as a new dependency for V1, same decision as Owner Statements' print-to-PDF); the CSV itself carries the disclaimer as its first line, and the on-screen JSON view returns it as a `disclaimer` field the UI renders verbatim.

## 8. Bank reconciliation

`bank_transactions` are matched to `rent_schedules`/`expenses`/`owner_statements` payouts via `calculateMatchScore` (retained from PropVault, `packages/utils`), which proposes matches — **never auto-confirms them**, carrying forward the existing product principle ("Confirmation is always a customer action... never silently mark paid," migration 000010 comment) unchanged into the new domain. A confirmed match triggers the corresponding `payment`/`owner_payout` journal entry.

## 8a. Tenant-reported payments vs the ledger (V1 utilities/rates/levies pass — full detail in `UTILITIES_RATES_BUDGET_IMPLEMENTATION.md`)

`payment_reports` (a tenant/staff *claim* layer, migration 20260101000106) is not itself the ledger and
never has been — `confirm_payment_report()` only ever flipped that table's own `status` column. This was
found, during the same pass, to be a real gap between what the UI implied ("payment confirmed") and what
`rent_schedules.status` actually showed: an owner tapping Confirm did not move the tenant to "paid."

Fixed in migration 20260101000165 without inventing a second ledger: `confirm_payment_report()` now calls
`record_invoice_payment()` — the same single entry point §3/§8 above already describe — whenever the
report references a specific `rent_schedule_id` with a matching *issued* invoice. If no invoice has been
issued yet, confirmation is refused (`invoice_not_issued`), never silently downgraded to
acknowledgement-only. If the report isn't tied to a specific schedule at all (an ad-hoc/advance payment),
it stays acknowledgement-only — a genuine ambiguity about which invoice it would apply to, not a
shortcut. Idempotent: re-confirming an already-confirmed report never re-allocates (pgTAP-verified).

## 9. Period locking (added by Production Readiness Review, 2026-07-30 — previously unaddressed: nothing stopped a backdated post into a month an accountant had already reconciled and reported on)

- `accounting_periods` (`DATABASE.md` §9 — `id`, `org_id`, `period_start`, `period_end`, `status enum(open|closed)`, `closed_by`, `closed_at`).
- The posting service (the sole write path to `journal_entries`, §1) checks the target `entry_date`'s period status before posting: a post dated into a `closed` period is **rejected**, not silently allowed. This is the mechanism that makes "I reconciled and reported on March" actually mean something — without it, a March Tax Pack export or Owner Statement could be invalidated by a post-hoc March entry with no warning.
- **Closing a period does not touch existing entries** (consistent with §1's immutability rule) — it only prevents _new_ entries dated into that period going forward. A correction to a closed period is a reversing entry dated in the _current open_ period that references the original (§1), never a reopening of the closed period itself, except via an explicit, `principal`-or-`accountant`-gated "reopen period" action that itself writes an `audit_events` row (reopening a closed accounting period is a significant enough action to be audited on its own, not just implied by the entries that follow).
- V1 scope: manual period closing (an accountant/principal explicitly closes a month once reconciled), not automatic — automatic period-close-on-schedule is a V2 refinement once there's real usage data on how orgs actually work month-end close.

## 10. Known edge cases (architecture review, 2026-07-30)

Four edge cases identified in review, with a V1 answer for each rather than left silently unhandled:

- **Partial rent payments.** A `bank_transaction` matched against a `rent_schedule` for less than the full amount posts a `payment` journal entry for the _actual matched amount_ (never the full scheduled amount) — `rent_schedules.status` moves to `partial`, not `paid`, and the remaining balance stays receivable. No special posting logic beyond "post what was actually matched" is needed; the partial/full distinction lives in `rent_schedules.status`, not in how the entry is built.
- **Multi-owner statement rounding.** When `property_owners.ownership_pct` values don't divide a period's net amount evenly (e.g. 33.33%/66.67% split of an amount not divisible by 3), the sum of individually-rounded owner shares can differ from the total by a cent. V1 answer: round each owner's share to the nearest cent independently, then post the rounding remainder (positive or negative, typically ≤ a few cents) to the _last_ owner in a stable sort order (e.g. by `owner_id`) for that property/period — never silently dropped, never left unbalanced. This keeps `SUM(owner shares) = total net payable` exactly, preserving the Trial Balance invariant (§6), at the cost of one owner's statement occasionally being a cent off from a naive even split — documented behavior, not a bug, if a statement is ever queried.
- **Mid-lease rent amendments.** Changing `leases.rent_amount` mid-lease does not retroactively alter already-generated `rent_schedules` rows (those are historical fact — what was actually due for a past period) or already-posted `journal_entries` (immutable, §1). A rent amendment takes effect for `rent_schedules` rows generated _after_ the change; if a correction to an already-generated-but-not-yet-due schedule is needed, that's a manual adjustment to the specific future `rent_schedules` row (allowed, since it hasn't been invoiced/posted yet) rather than a retroactive ledger edit. This is a V1 answer, not a full lease-amendment workflow (formal amendment documents, tenant acknowledgment) — that's a V2 feature; V1 just needs the accounting behavior to not corrupt history when a landlord changes a number.
- **Expenses spanning multiple properties** (e.g. shared building maintenance, a single vendor bill covering several units). `expenses.property_id` is singular in the V1 schema (`DATABASE.md` §9) — a shared expense is entered as one `expenses` row per property with a manually-apportioned amount (staff decides the split, e.g. equal per-unit or by floor area), not a single row magically divided by the system. No automatic apportionment logic exists in V1; flagged as a V2 candidate (a `expense_allocations` join table with a chosen apportionment method) if this proves a common enough workflow to warrant automating.

## 11. What does NOT get built in-house

Nothing in V1 — the confirmed decision is a fully in-house engine, no third-party accounting API integration (`DECISIONS.md`, 2026-07-29). This is flagged in `RETAIN_REFACTOR_REBUILD_MATRIX.md` as the highest-risk single workstream in the whole rebuild and gets a dedicated implementation milestone (`TASKS.md`) with its own test suite before any other module is allowed to post against it in production.
