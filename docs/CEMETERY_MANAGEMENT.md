# Cemetery Management

An **optional, organisation-level module**: cemetery → section/block → grave site, rights holders (purchasers), grave-site
sales or grants of burial rights, deposits and payments with receipts, reservations, withdrawn sites, burial records,
an interactive schematic layout and separate cemetery figures on the dashboard.

Added 2026-10-26: migration `20260101000184_cemetery_management.sql`, rollback
`supabase/rollback/20260101000184_cemetery_down.sql`, pgTAP `supabase/tests/cemetery_management.test.sql`.

## Who sees it

| | Module off (every organisation by default) | Module on |
| --- | --- | --- |
| Navigation | unchanged | adds a **Cemetery** section (register, sales, rights holders, burial register) |
| Dashboard | unchanged | adds **Cemetery operations** and **Income streams** panels |
| Pages `/cemetery/**` | 404 | principal, manager, accountant |
| API `/api/v1/cemetery/**` | 403 | writes: principal, manager; payments: also accountant |
| Database (RLS) | no rows, no writes | read: accountant+; write: manager+; payments: accountant+ |

Agents, viewers, owners, tenants and platform support sessions never see cemetery records: purchaser, next-of-kin
and burial details are personal information.

**Switch it on** for one organisation (owner action; there is deliberately no in-app toggle, same as Smart Utilities):

```sql
update public.organizations set cemetery_enabled = true where id = '<org id>';
```

Switching it off hides everything again and keeps the records.

## Data model

| Table | Purpose |
| --- | --- |
| `cemeteries` | name, address, `tenure_model` (`burial_rights` default, or `land_sale`), optional `rights_term_years`, `is_demo` |
| `cemetery_sections` | code (`A`), name, order, `sites_per_row` (schematic grid only) |
| `cemetery_sites` | `reference` (`A-001`), section/row/plot position, dimensions, `site_type`, `max_interments`, `list_price`, **`sale_status`** and **`burial_status`** (separate), reservation, withdrawal reason, notes |
| `cemetery_purchasers` | rights holder / purchaser: name, phone, e-mail, address, next of kin / authorised contact, notes. **Not a tenant**: no login, no portal, no messages |
| `cemetery_sales` | `GS-000001` numbering, site, purchaser, price, date, `tenure_model` snapshot, `status` (`active` / `cancelled`), `is_demo` |
| `cemetery_payments` | `GR-000001` receipt numbering, amount, date, method, reference, `is_deposit`, `is_demo`; append-only |
| `cemetery_burials` | deceased, dates, interment number, burial order number, undertaker |
| `cemetery_site_documents` | supporting-document register (title, type, reference) |
| `cemetery_sale_balances` (view) | price, amount paid, balance due per sale (`security_invoker`) |

Status models:
- **Sale / allocation:** Available, Reserved, Sold, Unavailable.
- **Burial / occupancy:** Unused, Occupied.
- **Burial rules:** `max_interments` per site (for example 2 for a double-depth grave). A burial needs an active sale.

Terminology follows the cemetery's `tenure_model`:
- `burial_rights`: "Grant of Right of Interment", "Rights holder", "Rights fee". The record states that ownership of
  the land is not transferred.
- `land_sale`: "Grave Plot Sale Agreement", "Purchaser", "Selling price".

## Rules the database enforces (for every writer, including the service role)

- **No double sale:** at most one active sale per site (partial unique index `cemetery_sales_one_active_per_site`),
  and the site row is locked while a sale is inserted. A reserved site can only be sold to the person it is reserved
  for.
- **No overpayment:** a payment trigger locks the sale and refuses any amount above the balance due.
- **Payments are append-only:** there is no UPDATE/DELETE privilege for signed-in users, and a trigger refuses edits
  from any writer.
- **Sales are immutable:** a recorded sale cannot be re-priced or re-pointed; a cancelled sale cannot be reactivated.
- **Status follows the records:** a site can only become Sold through a sale, cannot leave Sold while it has an active
  sale, and is Occupied exactly when it has a burial record.
- **Tenant isolation is structural:** every child row carries `org_id` and references its parent through a composite
  `(id, org_id)` foreign key, so no row can point at another organisation's cemetery, site, sale or purchaser.
- **Demo flag propagates:** under a cemetery with `is_demo`, every sale and payment is flagged `is_demo`. Sale
  records and receipts then say "DEMONSTRATION — not a real transaction".

The workflows run as `SECURITY INVOKER` functions, so they always run under the caller's RLS:
`cemetery_generate_sites` (idempotent), `cemetery_reserve_site`, `cemetery_release_reservation`,
`cemetery_set_site_unavailable`, `cemetery_record_sale`, `cemetery_record_payment` and `cemetery_record_burial`.

The payment-check trigger is `SECURITY DEFINER`, because an accountant may record payments but cannot lock a sale
row. It therefore verifies the caller's organisation and role first, and never reveals another organisation's sale
or balance.

## Accounting separation

Grave-site sales and payments live in their own tables. They never write `invoices`, `rent_schedules`,
`invoice_payments`, journals, owner statements or the trial balance:
- no rental figure changes;
- the dashboard shows rental income and grave-site payments as separate lines;
- a grave-site sale is never counted as monthly rental income.

Proplyst records money the cemetery says it received. It does not collect, request or move money.

## Audit trail without personal information

`audit_events` is readable by every member of an organisation (viewer+). The generic audit trigger copies whole rows,
which would expose purchaser and burial details to agents and viewers. Cemetery tables therefore use
`cemetery_audit_trigger(<columns>)`, which records only:
- identifiers;
- references;
- statuses;
- amounts and dates.

pgTAP checks that no purchaser or deceased name reaches `audit_events`.

## Screens

| Route | What it does |
| --- | --- |
| `/cemetery` | metrics; interactive layout (colour = sale status, marker = occupied; search by site, holder or deceased; filter by section, status, burial status; click a site for its details); recent sales; outstanding balances |
| `/cemetery/new` | create a cemetery with sections; sites are numbered automatically |
| `/cemetery/sites/[id]` | full site record and actions: sell/grant, reserve, release, withdraw, return to sale, record burial, edit details, add a document |
| `/cemetery/sales`, `/cemetery/sales/new`, `/cemetery/sales/[id]` | sales register with balances; the sale workflow; the printable sale record with payment history and the record-payment form |
| `/cemetery/receipts/[id]` | printable receipt with the balance after that payment |
| `/cemetery/purchasers`, `/new`, `/[id]`, `/[id]/edit` | rights holders: contact and next of kin, linked sites, agreements, payments, outstanding |
| `/cemetery/burials` | burial register |

The layout is a **schematic grid** (section, row, plot), not a surveyed or cadastral map.

The layout works at phone width: sections stack, and the details panel moves below the grid. The phone-width
Playwright check asserts that there is no horizontal page scroll.

## Demo organisation

`apps/admin/scripts/cemetery-demo/provision.demo.ts` is **idempotent**: every record is looked up by its natural key
before it is created. A re-run creates nothing, and an interrupted run is completed rather than duplicated.

It provisions **"Proplyst Property & Cemetery Demo"** with:
- the login `cemetery.demo@proplyst.co.za` (pre-confirmed);
- Riverside Heights Apartments: 12 units, 9 let, 3 vacant;
- Northgate Business Centre: 6 units, 5 let, 1 vacant;
- six months of rent schedules, invoices and payments, with one tenant overdue, one partial and one in arrears for two
  months;
- 8 maintenance tickets;
- Greenfields Memorial Gardens, a demo cemetery with sections A, B and C, 40 sites each:
  - 54 sold (25 occupied), 10 reserved, 51 available and 5 unavailable;
  - 26 rights holders, some holding several sites;
  - deposits, instalments, 20 sales with a balance, and 25 burial records.

Every person is fictional:
- Tenants have no e-mail and no phone, so no reminder or WhatsApp can reach anyone.
- Rights-holder e-mails use the reserved `.invalid` domain, and nothing in the module sends messages.

Guards:
- The target must be the local stack, or production with `CEMDEMO_CONFIRM_PRODUCTION=yes`.
- It refuses to adopt an account or organisation it did not create.
- It never re-passwords an existing account.
- A new login's password is written only to `CEMDEMO_CREDENTIALS_FILE`, a git-ignored `*.local` file; it is never
  printed.

```bash
# from apps/admin
CEMDEMO_SUPABASE_URL=... CEMDEMO_SERVICE_ROLE_KEY=... CEMDEMO_CONFIRM=seed-cemetery-demo \
CEMDEMO_CREDENTIALS_FILE=/abs/path/.env.cemetery-demo.local [CEMDEMO_CONFIRM_PRODUCTION=yes] \
npx vitest run -c vitest.demo.config.ts scripts/cemetery-demo/provision.demo.ts
```

`proplyst.co.za` has **no MX record** (checked 2026-10-26), so the demo address cannot receive e-mail.
- The login is created pre-confirmed with a strong random password; no confirmation or reset e-mail is involved.
- "Forgot password" cannot work for this address until the domain receives mail.
- To rotate the password: Supabase dashboard → Authentication → the user → reset/set password, then update the
  credentials file.

## Rollback

1. **Preferred:** switch the module off for the organisation (see above). The data stays, and everything is hidden.
2. **Code:** redeploy the previous commit. The old build ignores the new tables and column.
3. **Schema:** `supabase/rollback/20260101000184_cemetery_down.sql`.
   - It refuses while non-demo cemeteries exist.
   - Demo data needs `set proplyst.rollback_discard_cemetery_data = 'yes'`.
   - It was rehearsed on a production-data copy: the schema after rollback matched the 183 dump exactly.
4. The demo organisation cannot be fully deleted, because `audit_events` is immutable. Archive it instead:
   `update organizations set cemetery_enabled = false, status = 'archived' where legal_name = 'Proplyst Property & Cemetery Demo';`
   Then ban the demo login.

## Known limitations

- Supporting documents are a **register** (title, type, reference). Uploading files for cemetery records is not in
  this release; the sale record and receipts are generated by the app and printable/PDF-able from the browser.
- No sale cancellation or payment reversal screen yet. The data model supports cancellation (`status`,
  `cancelled_at`), and payments are append-only by design.
- No Super Admin toggle for `cemetery_enabled` (switched by SQL, like `utilities_enabled`).
- One cemetery-wide terminology per cemetery (`tenure_model`); there is no per-site override.
- Grave-site payments are not posted to the general ledger; they are reported in the cemetery module and on the
  dashboard's separate panel.
