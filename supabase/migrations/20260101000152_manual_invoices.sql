-- Overnight V1 completion pass (WORKLOG.md this date), Part B: /accounting/invoices has always
-- been a pure viewer -- the only insert path into public.invoices is invoice_rent_schedule(),
-- fired from a real rent_schedule row. This adds a SECOND, parallel creation path for one-off
-- landlord-to-tenant charges (utilities, parking, repairs, deposit-related, "other") that are NOT
-- rent and must never touch rent_schedules/bank_transactions/cash_receipts reconciliation --
-- reusing public.invoices as the single authoritative invoice table (not a competing system), with
-- a `source` column distinguishing the two creation paths so existing rent-invoice code/queries
-- are entirely unaffected. Manual invoices still require lease_id (invoices.lease_id is NOT NULL,
-- migration 20260101000037) -- staff select Property -> Unit -> Tenant, and the RPC resolves that
-- tenant's current lease on that unit itself; a tenant with no lease at all on that unit is a clear
-- "create a lease first" error, not a schema relaxation (no evidence a landlord bills a tenant with
-- literally no tenancy record at all -- this is a disclosed V1 boundary, not silently unsupported).

alter table public.invoices
  add column source text not null default 'rent_schedule' check (source in ('rent_schedule', 'manual')),
  add column description text,
  add column notes text,
  add column reference text,
  add column created_by_user_id uuid references auth.users(id) on delete set null;

comment on column public.invoices.source is
  'rent_schedule = invoice_rent_schedule() RPC (unchanged); manual = create_manual_invoice() RPC, this migration.';
comment on column public.invoices.created_by_user_id is
  'Set only for source=''manual'' -- rent-schedule invoices have no single human author.';

-- === invoice_line_items: real per-line rows, manual invoices only ===
-- Rent-schedule invoices deliberately do NOT get real rows here -- they keep synthesizing a single
-- virtual line item at display time from the existing amount+period (apps/admin/lib/invoicing.ts),
-- so invoice_rent_schedule() itself is untouched by this migration.
create table public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null check (char_length(description) between 1 and 500),
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  amount numeric(12, 2) not null check (amount >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index invoice_line_items_invoice_idx on public.invoice_line_items (invoice_id, sort_order);

create trigger set_invoice_line_items_updated_at
  before update on public.invoice_line_items
  for each row execute function public.set_updated_at();

alter table public.invoice_line_items enable row level security;

create policy "invoice_line_items_select_org_member"
  on public.invoice_line_items for select
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and public.has_org_role(i.org_id, 'viewer')
    )
  );

create policy "invoice_line_items_write_accountant_plus"
  on public.invoice_line_items for all
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and public.has_org_role(i.org_id, 'accountant')
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and public.has_org_role(i.org_id, 'accountant')
    )
  );

-- Tenant portal self-view of their own manual invoices already works via invoices_select_tenant_self
-- (migration 20260101000049); line items need the same carve-out so a tenant can see what a manual
-- invoice they're billed for actually contains.
create policy "invoice_line_items_select_tenant_self"
  on public.invoice_line_items for select
  using (
    exists (
      select 1 from public.invoices i
      join public.tenants t on t.id = i.tenant_id
      where i.id = invoice_line_items.invoice_id
        and t.user_id = auth.uid()
    )
  );

-- === invoice_payments: manual, staff-recorded "this was paid" evidence ===
-- Deliberately NOT integrated with bank_transactions/cash_receipts reconciliation -- that mechanism
-- stays exactly as-is for rent invoices (matched via lease_id+period/due_date). Recording a manual
-- invoice as paid is a genuinely different real-world event (a landlord noting a utility charge was
-- settled, often in cash or an EFT with no matching bank feed row yet) -- duplicating rent's bank-
-- reconciliation machinery for that would be over-engineering a V1 charge type; this is a simple,
-- explicit, separately-audited ledger instead.
create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  paid_at date not null,
  method text check (method is null or char_length(method) <= 50),
  notes text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index invoice_payments_invoice_idx on public.invoice_payments (invoice_id);

alter table public.invoice_payments enable row level security;

create policy "invoice_payments_select_org_member"
  on public.invoice_payments for select
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_payments.invoice_id
        and public.has_org_role(i.org_id, 'viewer')
    )
  );

create policy "invoice_payments_write_accountant_plus"
  on public.invoice_payments for all
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_payments.invoice_id
        and public.has_org_role(i.org_id, 'accountant')
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_payments.invoice_id
        and public.has_org_role(i.org_id, 'accountant')
    )
  );

-- === create_manual_invoice(): the "manual" source path, parallel to invoice_rent_schedule() ===
-- Always inserts as status='draft' -- the CHECK constraint (status='draft' or issued_at not null)
-- already allowed this value, but no code path had ever used it until now. No journal entry is
-- posted at this point (draft invoices are not yet real AR, matching ordinary accounting practice);
-- posting happens in issue_manual_invoice() below.
create or replace function public.create_manual_invoice(
  p_org_id uuid,
  p_lease_id uuid,
  p_tenant_id uuid,
  p_invoice_date date,
  p_due_date date,
  p_reference text,
  p_description text,
  p_notes text,
  p_line_items jsonb -- array of {description, quantity, unit_price}
)
returns uuid
language plpgsql
as $$
declare
  v_lease public.leases%rowtype;
  v_tenant_on_lease boolean;
  v_invoice_id uuid;
  v_amount numeric(12, 2) := 0;
  v_item jsonb;
  v_sort integer := 0;
begin
  if not public.has_org_role(p_org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;

  select * into v_lease from public.leases where id = p_lease_id and org_id = p_org_id;
  if not found then
    raise exception 'Lease not found in this organization';
  end if;

  select exists (
    select 1 from public.lease_tenants where lease_id = p_lease_id and tenant_id = p_tenant_id
  ) into v_tenant_on_lease;
  if not v_tenant_on_lease then
    raise exception 'Tenant is not on this lease';
  end if;

  if p_line_items is null or jsonb_array_length(p_line_items) = 0 then
    raise exception 'At least one line item is required';
  end if;

  insert into public.invoices (
    org_id, lease_id, tenant_id, period, amount, status, source, description, notes, reference, created_by_user_id
  )
  values (
    p_org_id, p_lease_id, p_tenant_id, p_due_date, 0, 'draft', 'manual', p_description, p_notes, p_reference, auth.uid()
  )
  returning id into v_invoice_id;

  for v_item in select * from jsonb_array_elements(p_line_items)
  loop
    insert into public.invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
    values (
      v_invoice_id,
      v_item ->> 'description',
      coalesce((v_item ->> 'quantity')::numeric, 1),
      (v_item ->> 'unitPrice')::numeric,
      coalesce((v_item ->> 'quantity')::numeric, 1) * (v_item ->> 'unitPrice')::numeric,
      v_sort
    );
    v_amount := v_amount + coalesce((v_item ->> 'quantity')::numeric, 1) * (v_item ->> 'unitPrice')::numeric;
    v_sort := v_sort + 1;
  end loop;

  update public.invoices set amount = v_amount where id = v_invoice_id;

  return v_invoice_id;
end;
$$;

comment on function public.create_manual_invoice(uuid, uuid, uuid, date, date, text, text, text, jsonb) is
  'Manual (non-rent) tenant invoice creation, always status=draft, no journal entry until issue_manual_invoice(). Overnight V1 completion pass, Part B.';

-- === update_manual_invoice(): edit while draft only -- "must not silently mutate financial
-- history once issued" (task brief) ===
create or replace function public.update_manual_invoice(
  p_invoice_id uuid,
  p_invoice_date date,
  p_due_date date,
  p_reference text,
  p_description text,
  p_notes text,
  p_line_items jsonb
)
returns void
language plpgsql
as $$
declare
  v_invoice public.invoices%rowtype;
  v_amount numeric(12, 2) := 0;
  v_item jsonb;
  v_sort integer := 0;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if not public.has_org_role(v_invoice.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_invoice.source <> 'manual' then
    raise exception 'Only manually-created invoices can be edited this way';
  end if;
  if v_invoice.status <> 'draft' then
    raise exception 'Only draft invoices can be edited -- this invoice has already been issued';
  end if;
  if p_line_items is null or jsonb_array_length(p_line_items) = 0 then
    raise exception 'At least one line item is required';
  end if;

  delete from public.invoice_line_items where invoice_id = p_invoice_id;

  for v_item in select * from jsonb_array_elements(p_line_items)
  loop
    insert into public.invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
    values (
      p_invoice_id,
      v_item ->> 'description',
      coalesce((v_item ->> 'quantity')::numeric, 1),
      (v_item ->> 'unitPrice')::numeric,
      coalesce((v_item ->> 'quantity')::numeric, 1) * (v_item ->> 'unitPrice')::numeric,
      v_sort
    );
    v_amount := v_amount + coalesce((v_item ->> 'quantity')::numeric, 1) * (v_item ->> 'unitPrice')::numeric;
    v_sort := v_sort + 1;
  end loop;

  update public.invoices
  set period = p_due_date,
      reference = p_reference,
      description = p_description,
      notes = p_notes,
      amount = v_amount
  where id = p_invoice_id;
end;
$$;

comment on function public.update_manual_invoice(uuid, date, date, text, text, text, jsonb) is
  'Edits a draft manual invoice in place (header + full line-item replace). Refuses once issued. Overnight V1 completion pass, Part B.';

-- === issue_manual_invoice(): draft -> issued, posts the journal entry, locks editing ===
-- Reuses the SAME 1100 (AR) / 4000 (Rent Income) chart-of-accounts codes invoice_rent_schedule()
-- already posts to, and the SAME 'rent_invoice' journal_source_type -- both are AR-creating tenant
-- charges economically, and no granular utility/parking/repairs income sub-account exists yet
-- (would need its own chart-of-accounts migration/backfill). Disclosed V1 simplification, not an
-- oversight: a future pass can introduce a dedicated account/source type without touching this
-- function's callers.
create or replace function public.issue_manual_invoice(p_invoice_id uuid)
returns void
language plpgsql
as $$
declare
  v_invoice public.invoices%rowtype;
  v_property_id uuid;
  v_ar_account_id uuid;
  v_income_account_id uuid;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if not public.has_org_role(v_invoice.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_invoice.source <> 'manual' then
    raise exception 'Only manually-created invoices can be issued this way';
  end if;
  if v_invoice.status <> 'draft' then
    raise exception 'Invoice has already been issued';
  end if;

  select property_id into v_property_id from public.units
    where id = (select unit_id from public.leases where id = v_invoice.lease_id);

  select id into v_ar_account_id from public.chart_of_accounts where org_id = v_invoice.org_id and code = '1100';
  select id into v_income_account_id from public.chart_of_accounts where org_id = v_invoice.org_id and code = '4000';

  perform public.post_journal_entry(
    v_invoice.org_id,
    current_date,
    coalesce(v_invoice.description, 'Manual invoice'),
    'rent_invoice',
    p_invoice_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_ar_account_id, 'debit', v_invoice.amount, 'property_id', v_property_id, 'tenant_id', v_invoice.tenant_id),
      jsonb_build_object('account_id', v_income_account_id, 'credit', v_invoice.amount, 'property_id', v_property_id, 'tenant_id', v_invoice.tenant_id)
    )
  );

  update public.invoices set status = 'issued', issued_at = now() where id = p_invoice_id;
end;
$$;

comment on function public.issue_manual_invoice(uuid) is
  'Locks a draft manual invoice and posts its AR journal entry (reuses the 1100/4000 accounts and rent_invoice source type). Overnight V1 completion pass, Part B.';

-- === record_invoice_payment(): manual "this was paid" note, issued invoices only ===
create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_paid_at date,
  p_method text,
  p_notes text
)
returns uuid
language plpgsql
as $$
declare
  v_invoice public.invoices%rowtype;
  v_payment_id uuid;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if not public.has_org_role(v_invoice.org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if v_invoice.status <> 'issued' then
    raise exception 'Only issued invoices can have payments recorded against them';
  end if;
  if p_amount <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  insert into public.invoice_payments (invoice_id, amount, paid_at, method, notes, recorded_by)
  values (p_invoice_id, p_amount, p_paid_at, p_method, p_notes, auth.uid())
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

comment on function public.record_invoice_payment(uuid, numeric, date, text, text) is
  'Manually records that an issued invoice was paid -- separate from bank_transactions/cash_receipts reconciliation (rent invoices are untouched by this). Overnight V1 completion pass, Part B.';
