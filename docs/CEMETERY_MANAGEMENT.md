# Cemetery Management

An **optional, organisation-level module**: cemetery → section/block → grave site, rights holders (purchasers), grave-site
sales or grants of burial rights, deposits and payments with receipts, reservations, cancellations, withdrawn sites,
burial records, a per-site history, an interactive schematic layout, monthly reports and separate cemetery figures on
the dashboard.

Introduced 2026-10-26:
- migration `20260101000184_cemetery_management.sql`, rollback `supabase/rollback/20260101000184_cemetery_down.sql`;
- pgTAP `supabase/tests/cemetery_management.test.sql` (68 assertions).

The same change adds migration `20260101000185_invoice_number_sequence_resync.sql`, a rental-invoice numbering fix
described [below](#invoice-numbering-fix-migration-185).

## Who sees it

| | Module off (every organisation by default) | Module on |
| --- | --- | --- |
| Navigation | unchanged | adds a **Cemetery** section (register, sales, rights holders, burial register, reports) |
| Dashboard | unchanged | adds **Cemetery operations** and **Income streams** panels |
| Pages `/cemetery/**` | 404 | principal, manager, accountant |
| API `/api/v1/cemetery/**` | 403 | writes: principal, manager; payments: also accountant |
| Database (RLS) | no rows, no writes | read: accountant+; write: manager+; payments: accountant+; history: read-only |

Agents, viewers, owners, tenants and platform support sessions never see cemetery records: purchaser, next-of-kin
and burial details are personal information.

**Switch it on** for one organisation. This is an owner action; there is deliberately no in-app toggle (TD-75):

```sql
update public.organizations set cemetery_enabled = true where id = '<org id>';
```

Switching it off hides everything again and keeps the records.

## Data model

| Table | Purpose |
| --- | --- |
| `cemeteries` | name, address, `tenure_model` (`burial_rights` default, or `land_sale`), optional `rights_term_years`, `is_demo` |
| `cemetery_sections` | code (`A`), name, order, `sites_per_row` (schematic grid only) |
| `cemetery_sites` | `reference` (`A-001`), section/row/plot, dimensions, `site_type`, `max_interments`, `list_price`, **`sale_status`** and **`burial_status`** (separate), reservation, withdrawal reason, notes |
| `cemetery_purchasers` | rights holder / purchaser: name, phone, e-mail, address, next of kin / authorised contact, notes. **Not a tenant**: no login, no portal, no messages |
| `cemetery_sales` | `GS-000001`, site, purchaser, price, date, `tenure_model` snapshot, `status` (`active` / `cancelled`), cancellation date and reason, `is_demo` |
| `cemetery_payments` | `GR-000001` receipts, amount, date, method, reference, `is_deposit`, `is_demo`; append-only |
| `cemetery_burials` | deceased, dates, interment number, burial order number, undertaker |
| `cemetery_site_events` | **site history**: reserved, reservation released, sold, sale cancelled, withdrawn, returned to sale, burial — each with its effective date |
| `cemetery_site_documents` | supporting-document register (title, type, reference) |
| `cemetery_sale_balances` (view) | price, amount paid, balance due per sale (a cancelled sale owes nothing) |

Status models:
- **Sale / allocation:** Available, Reserved, Sold, Unavailable.
- **Burial / occupancy:** Unused, Occupied.
- **Burial rules:** `max_interments` per site (for example 2 for a double-depth grave). A burial needs an active sale.

Terminology follows `tenure_model`:
- `burial_rights`: "Grant of Right of Interment", "Rights holder", "Rights fee". The record states that the land is
  not transferred.
- `land_sale`: "Grave Plot Sale Agreement", "Purchaser", "Selling price".

## Rules the database enforces (every writer, including the service role)

- **No double sale.** At most one active sale per site (partial unique index); the site row is locked during a sale; a
  reserved site can only be sold to its holder.
- **No overpayment.** A payment trigger locks the sale and refuses any amount above the balance.
- **Append-only records.** Payments and site history cannot be edited or deleted.
- **Sales are immutable.** A sale cannot be re-priced or re-pointed, and a cancelled sale cannot be reactivated.
- **Status follows the records.** A site becomes Sold only through a sale, and leaves Sold only through a
  cancellation. It is Occupied exactly when it has a burial.
- **Chronology:**
  - Nothing is dated after today (South African date).
  - A payment is never dated before its sale.
  - A cancellation is never dated before the sale or its last payment.
  - Each site's history stays in date order: an event dated before the site's latest event is refused. A sale can
    therefore never precede its reservation, and a release never precedes the reservation.
- **Cancellation.** `cemetery_cancel_sale(sale, reason, date)`:
  - The site returns to Available, and money already received stays on record. Refunds, if any, happen outside
    Proplyst.
  - It is refused once a burial is recorded under the sale.
- **Tenant isolation is structural.** Every child row carries `org_id` and references its parent through a composite
  `(id, org_id)` foreign key.
- **Demo flag propagates.** Under a cemetery with `is_demo`, every sale and payment is flagged `is_demo`, and the
  records say "DEMONSTRATION — not a real transaction".

The workflow functions are `SECURITY INVOKER`, so they run under the caller's RLS:
- `cemetery_generate_sites` (idempotent);
- `cemetery_reserve_site(…, p_reserved_on)`, `cemetery_release_reservation(…, p_released_on)`,
  `cemetery_set_site_unavailable(…, p_effective_on)`;
- `cemetery_record_sale`, `cemetery_record_payment`, `cemetery_cancel_sale`, `cemetery_record_burial`.

The history is written by `SECURITY DEFINER` triggers. Users have no INSERT privilege on it, so they cannot forge it.

## Accounting separation

Grave-site sales and payments never write invoices, rent schedules, journals, owner statements or the trial balance:
- rental figures are untouched;
- the dashboard shows rental income and grave-site payments as separate lines;
- grave-site money is not in the general ledger yet (TD-74).

Proplyst records money the cemetery says it received. It does not collect, request or move money.

## Audit trail without personal information

`audit_events` is readable by every member of an organisation (viewer+). Cemetery tables therefore use
`cemetery_audit_trigger(<columns>)`, which records only identifiers, references, statuses, amounts and dates.
pgTAP checks that no purchaser or deceased name reaches `audit_events`.

## Screens

| Route | What it does |
| --- | --- |
| `/cemetery` | metrics; interactive layout (colour = sale status, marker = occupied; search by site, holder or deceased; filter by section, status or burial status; click a site for its details); recent sales; balances |
| `/cemetery/reports` | last 12 months or a calendar year. Per month: sites sold, sales value, cancellations, deposits, instalments, payments collected, outstanding at month end, reservations, burials, site status at month end. Chart of sales against collections; totals; **drill-down** into a month's sales, receipts, reservations, cancellations and burials |
| `/cemetery/sites/[id]` | site record, **site history**, actions (sell/grant, reserve, release, withdraw, return to sale, record burial, edit, add document) |
| `/cemetery/sales` (`?filter=outstanding\|paid\|cancelled&month=YYYY-MM`) | sales register with balances |
| `/cemetery/sales/new` | the sale workflow |
| `/cemetery/sales/[id]` | printable sale record with payment history; record-payment form; **cancel** |
| `/cemetery/receipts/[id]` | printable receipt with the balance after that payment |
| `/cemetery/purchasers` … | rights holders: contact and next of kin, linked sites, agreements, payment history, outstanding |
| `/cemetery/burials` | burial register |

The layout is a **schematic grid** (section, row, plot), not a surveyed or cadastral map. All pages work at phone width;
Playwright asserts that there is no horizontal page scroll.

Changes to existing property reporting (available to every organisation):

**Dashboard:**
- new period options: **Last 12 months**, a **month** picker and a **year** picker;
- the income-against-collections chart now covers 12 months.

**Reports:**
- a 12-month income and expense chart;
- a **Monthly performance** table showing rent billed, cash received, outstanding at month end, expenses, net cash and
  occupancy;
- each month links to the dashboard filtered to that month.

## Demo organisation: one year of operations

**Plan:** `apps/admin/scripts/cemetery-demo/plan.ts` defines the year 1 November 2025 to 31 October 2026 as data.
Nothing is ever dated after the day the plan runs. Unit tests in `__tests__/plan.test.ts` replay the plan and prove:
- it is chronological;
- no site is sold twice;
- there is no overpayment;
- every month has sales and payments;
- the reservation → deposit → instalments → settled story holds;
- there are no overlapping leases.

**Provisioner:** `provision.demo.ts` replays the plan through the app's own database functions, signed in as the demo
login (an admin magic-link token, so no e-mail is sent and the password is not used):

| Records | Functions used |
| --- | --- |
| Rent | `invoice_rent_schedule` (journal on the due date), `record_invoice_payment` (journal on the payment date), `recompute_rent_schedule_status` |
| Expenses | `post_journal_entry` on the expense date |
| Cemetery | the `cemetery_*` functions, with effective dates |

Before it finishes it **asserts that the books reconcile**:
- invoices equal the accounts-receivable journals;
- rent received equals the bank journals;
- expenses equal the expense journals;
- cemetery payments equal the per-sale totals.

It is **idempotent**: re-running creates nothing (CI runs it twice with `CEMDEMO_EXPECT_NO_CHANGES=1`).

What it creates. Figures come from the local run on 2026-10-26; they grow by date when it is re-run later.

**Properties**

Riverside Heights Apartments (12 units) and Northgate Business Centre (6 units):
- 19 tenants and 23 leases, including:
  - 4 renewals with escalations;
  - a tenant change (Unit 106);
  - vacancies (Units 104 and 205 let during the year; Units 203 and 206 and Suite 201 vacant now; 15 of 18 units
    occupied).
- 190 rent invoices and 188 rent payments, including:
  - late payers;
  - January paid in February;
  - partial payments caught up;
  - October arrears of R116,675 (Unit 103, Unit 201 partial, Suite 102, Warehouse A for September and October).
- 168 expenses posted to the ledger: monthly rates, security, insurance, cleaning, electricity, water and garden
  services, plus 12 repairs.
- 15 maintenance tickets across the year.

**Greenfields Memorial Gardens**

- **Opening register:** 33 sales captured at go-live, with older sales fully paid and 15 historic burials.
- **The year:** 46 sales, 3 cancelled:
  - a deposit retained after relocation;
  - a site re-sold in June;
  - a duplicate purchase consolidated.
- **Reservations:**
  - converted to a sale, for example Kavitha Moodley: reserved 12 January → deposit 9 February → 5 instalments →
    settled 14 August;
  - lapsed (3);
  - still held (10).
- **Payment plans** of 3, 6 and 10 months, a few in arrears.
- **Burials:** 14 in the year (pre-need and at-need, including a second interment in a double grave).
- **Site changes:** 6 withdrawals, one returned to sale, and list prices that rise every 1 July.
- **Position now:** 76 sold, 10 reserved, 29 available, 5 unavailable, 28 occupied, 56 rights holders, 225 receipts,
  R79,686.66 outstanding.

Every person, business and amount is fictional:
- tenants have no e-mail or phone, so no reminder or WhatsApp can reach anyone;
- rights holders use `.invalid` e-mail addresses;
- notes say "fictional";
- the cemetery is `is_demo`, so receipts say "DEMONSTRATION".

Guards:
- The target must be the local stack, or production with `CEMDEMO_CONFIRM_PRODUCTION=yes`.
- It refuses to adopt an account or organisation it did not create.
- It never re-passwords an existing account.
- A new login's password goes only to `CEMDEMO_CREDENTIALS_FILE`, a git-ignored `*.local` file.

```bash
# from apps/admin
CEMDEMO_SUPABASE_URL=... CEMDEMO_SERVICE_ROLE_KEY=... CEMDEMO_ANON_KEY=... CEMDEMO_CONFIRM=seed-cemetery-demo \
CEMDEMO_CREDENTIALS_FILE=/abs/path/.env.cemetery-demo.local [CEMDEMO_CONFIRM_PRODUCTION=yes] \
npx vitest run -c vitest.demo.config.ts scripts/cemetery-demo/provision.demo.ts
```

`proplyst.co.za` has **no MX record** (checked 2026-10-26), so `cemetery.demo@proplyst.co.za` cannot receive e-mail.
The login is created pre-confirmed with a strong random password, and "forgot password" cannot work for it. To rotate
the password: Supabase dashboard → Authentication → the user → set password, then update the credentials file.

## Invoice numbering fix (migration 185)

Found while preparing the demo, 2026-10-26. In production `invoice_number_seq` stood at **3** while invoice numbers up
to **INV-002296** existed:
- the marketing demo portfolio (432 invoices) was copied in **with** its invoice numbers by
  `scripts/provision-production-demo-portfolio.mjs`, which copies every column except `id` and never advances the
  sequence;
- the UAT portfolio holds INV-000003 to INV-000007.

The next generated number, INV-000004, therefore already existed. Every new rent invoice for every organisation would
have failed on the unique invoice-number constraint; no invoice had been created since 2026-09-08.

Migration 185:
1. moves the sequence past the highest number in use, never backwards;
2. makes `set_invoice_number()` skip any generated number that is already taken.

Existing numbers are unchanged; new invoices continue from INV-002297. This was rehearsed on a production-data copy,
with the sequence set back to 3 to reproduce the problem. pgTAP: `invoice_number_resync.test.sql`.

Recommendation: any future data copy should drop `invoice_number` and let the trigger number the rows.

## Rollback

1. **Preferred:** switch the module off for the organisation. The data stays, and everything is hidden.
2. **Code:** redeploy the previous commit. The old build ignores the new tables and column.
3. **Schema:** `supabase/rollback/20260101000184_cemetery_down.sql`.
   - It refuses while non-demo cemeteries exist.
   - Demo data needs `set proplyst.rollback_discard_cemetery_data = 'yes'`.
   - It was rehearsed on a production-data copy: the schema after rollback matched the pre-184 dump, except 185's
     intended change.
4. **Migration 185:** no rollback needed. A sequence only moves forward, and the skip loop is harmless.
5. **Demo organisation:** archive it, because `audit_events` is immutable:
   `update organizations set cemetery_enabled = false, status = 'archived' where legal_name = 'Proplyst Property & Cemetery Demo';`
   Then ban the demo login.

## Known limitations

- Supporting documents are a **register** (title, type, reference): there is no file upload for cemetery records yet.
  Sale records and receipts are generated by the app and can be printed or saved as PDF from the browser.
- No payment reversal screen. Payments are append-only by design.
- No Super Admin toggle for `cemetery_enabled`; it is switched by SQL (TD-75).
- One terminology per cemetery (`tenure_model`).
- Grave-site payments are not posted to the general ledger (TD-74).
- The new Reports monthly table reads invoices and payments without paging. That is fine for hundreds of rows; an
  organisation with more than 1,000 invoices needs the paged loader (TD-71 already tracks unpaged lists).
