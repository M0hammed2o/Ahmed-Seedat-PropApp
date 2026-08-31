-- Final completion + security hardening pass (WORKLOG.md this date), P1 "Organisation invoice
-- settings" + the historical-immutability question it raises. Three pieces:
--
-- 1. Genuinely new invoice-presentation fields on organizations. Existing fields are reused where
--    they already represent the right thing (legal_name/trading_name for display name, vat_no/
--    cipc_reg_no for registration display, support_contact_name/support_phone/support_email for
--    contact info -- all audited against 20260101000017/20260101000093 before adding anything) --
--    only address/payment-instructions/notes/footer are genuinely missing.
--
-- 2. organizations.invoice_prefix (20260101000017) has been dead code since it was added --
--    generate_invoice_number() hardcoded 'INV-' and never read it, confirmed by grep before this
--    migration and already flagged in 20260101000073's own comment ("invoice_prefix was reserved
--    for and which nothing in this codebase actually implements yet"). The organisation settings
--    UI already lets a landlord type a custom prefix, save it successfully, and see every
--    subsequent invoice number ignore it completely -- a real, silent lie, now fixed. A column
--    DEFAULT cannot see another column of the same INSERT (org_id), so the old
--    `invoice_number text unique default generate_invoice_number()` becomes a BEFORE INSERT
--    trigger instead; invoice_rent_schedule() and create_manual_invoice() are UNCHANGED (neither
--    ever set invoice_number explicitly, both keep relying on it being filled in automatically).
--    The underlying counter stays ONE global sequence (invoice_number_seq, unchanged) -- only the
--    prefix becomes per-org; changing to genuinely per-org counters was not asked for and is a
--    bigger, separate change.
--
-- 3. Snapshot: "changing invoice defaults must NOT rewrite previously issued invoices silently."
--    issue_manual_invoice() now freezes the org's presentation fields (as they are AT ISSUE time,
--    not creation time -- a still-draft invoice should reflect a settings change made while it's
--    being prepared) into invoices.presentation_snapshot. The PDF renderer (this pass's other P1
--    item) reads the snapshot when present and only falls back to live organizations columns for
--    invoices that predate this column (rent-schedule invoices, and any manual invoice issued
--    before this migration) -- so a later settings change can never silently alter what an already
--    -issued invoice says it said.

alter table public.organizations
  add column invoice_address text check (invoice_address is null or char_length(invoice_address) <= 500),
  add column invoice_payment_instructions text check (invoice_payment_instructions is null or char_length(invoice_payment_instructions) <= 1000),
  add column invoice_notes_default text check (invoice_notes_default is null or char_length(invoice_notes_default) <= 1000),
  add column invoice_footer text check (invoice_footer is null or char_length(invoice_footer) <= 500);

comment on column public.organizations.invoice_address is
  'Free-text postal/business address shown on tenant invoices (public.invoices, not
   subscription_invoices) -- organizations has no general address field, this is invoice-specific
   by design. Final hardening pass, migration 154.';
comment on column public.organizations.invoice_payment_instructions is
  'e.g. bank name/account/reference format -- shown on the invoice PDF only when set. Never
   fabricated by the renderer if this is null. Final hardening pass, migration 154.';
comment on column public.organizations.invoice_notes_default is
  'Optional default notes text pre-filled (not force-applied) when a landlord creates a new manual
   invoice -- the invoice''s own notes field can still be edited/cleared per invoice while draft.';
comment on column public.organizations.invoice_footer is
  'Distinct from communication_footer (20260101000093, used in tenant email/WhatsApp templates) --
   an invoice PDF is a different medium with potentially different footer text (e.g. banking/legal
   boilerplate vs a WhatsApp sign-off).';

alter table public.invoices
  add column presentation_snapshot jsonb;

comment on column public.invoices.presentation_snapshot is
  'Frozen copy of the issuing organisation''s invoice-presentation fields (display name, address,
   registration/VAT numbers, contact, payment instructions, footer) captured at issue time by
   issue_manual_invoice() -- never re-read live once set, so a later Organisation -> Settings ->
   Invoice settings change cannot silently alter what an already-issued invoice says. Null for
   rent-schedule invoices (invoice_rent_schedule() is unchanged by this migration) and for any
   invoice issued before this column existed -- the PDF renderer falls back to live organizations
   columns in that case. Final hardening pass, migration 154.';

-- === invoice_prefix wiring ===
create or replace function public.generate_invoice_number(p_org_id uuid)
returns text
language sql
as $$
  select coalesce(
    (select invoice_prefix from public.organizations where id = p_org_id),
    'INV'
  ) || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0');
$$;

comment on function public.generate_invoice_number(uuid) is
  'Per-org prefix (organizations.invoice_prefix, previously dead), single shared global counter
   (invoice_number_seq, unchanged) -- replaces the old zero-arg, hardcoded-''INV-'' version. Final
   hardening pass, migration 154.';

alter table public.invoices alter column invoice_number drop default;

drop function if exists public.generate_invoice_number();

create or replace function public.set_invoice_number()
returns trigger
language plpgsql
as $$
begin
  if new.invoice_number is null then
    new.invoice_number := public.generate_invoice_number(new.org_id);
  end if;
  return new;
end;
$$;

comment on function public.set_invoice_number() is
  'Replaces invoices.invoice_number''s old column DEFAULT (which could not see NEW.org_id, so could
   never have honoured a per-org prefix) -- invoice_rent_schedule() and create_manual_invoice() are
   both unchanged; neither ever set invoice_number explicitly, so this trigger firing in their place
   is transparent to both. Final hardening pass, migration 154.';

create trigger set_invoices_invoice_number
  before insert on public.invoices
  for each row execute function public.set_invoice_number();

-- === issue_manual_invoice(): now also freezes the presentation snapshot ===
create or replace function public.issue_manual_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_org public.organizations%rowtype;
  v_property_id uuid;
  v_ar_account_id uuid;
  v_income_account_id uuid;
  v_snapshot jsonb;
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

  select * into v_org from public.organizations where id = v_invoice.org_id;
  v_snapshot := jsonb_build_object(
    'orgDisplayName', coalesce(v_org.trading_name, v_org.legal_name),
    'orgAddress', v_org.invoice_address,
    'cipcRegNo', v_org.cipc_reg_no,
    'vatNo', v_org.vat_no,
    'contactName', v_org.support_contact_name,
    'contactPhone', v_org.support_phone,
    'contactEmail', v_org.support_email,
    'paymentInstructions', v_org.invoice_payment_instructions,
    'footer', v_org.invoice_footer
  );

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

  update public.invoices
  set status = 'issued', issued_at = now(), presentation_snapshot = v_snapshot
  where id = p_invoice_id;
end;
$$;
