-- Landlord/staff launch-hardening pass (WORKLOG.md 2026-08-26), Section 17/18: a real production
-- error was found manually testing "Record expense" -- "null value in column account_id of
-- relation journal_lines violates not-null constraint". Root-caused (not guessed): any
-- organization created BEFORE migration 20260101000035 added chart-of-accounts seeding to
-- create_organization() has zero chart_of_accounts rows. No migration ever backfilled them.
-- record_expense()'s category-to-account lookup (and its Accounts Payable/Business Bank credit-
-- side lookup) has no null guard, so it silently passes a null account_id straight into
-- post_journal_entry(), which inserts it unchecked. Two independent fixes:
--
-- 1. Backfill: call the EXISTING, unmodified seed_chart_of_accounts(org_id) for every
--    organization that currently has zero chart_of_accounts rows. Purely additive -- an org that
--    already has any accounts (even a partial/unusual set) is left completely untouched, so this
--    can never violate the (org_id, code) uniqueness constraint or rewrite an existing row.
-- 2. A general guard in post_journal_entry() itself (not just record_expense()) -- the sole write
--    path for journal_entries/journal_lines together, so this closes the gap for every current
--    and future poster (expenses, rent invoicing, deposits, reversals, ...), not just the one
--    flow that happened to be manually tested. Raises a friendly, prefixed, catchable exception
--    instead of ever reaching the raw NOT NULL constraint text.

-- === 1. Backfill missing chart_of_accounts for pre-migration-35 organizations ===
do $$
declare
  v_org record;
  v_count integer := 0;
begin
  for v_org in
    select o.id from public.organizations o
    where not exists (select 1 from public.chart_of_accounts c where c.org_id = o.id)
  loop
    perform public.seed_chart_of_accounts(v_org.id);
    v_count := v_count + 1;
  end loop;
  raise notice 'chart_of_accounts backfill: seeded % organization(s) that had zero accounts', v_count;
end $$;

-- === 2. post_journal_entry(): reject a null/unresolvable account_id before it ever reaches the
-- journal_lines insert, with a clear, friendly, prefixed message (matches this codebase's
-- existing "commercial_setup_required:"/"property_limit_reached:" prefixed-exception convention
-- for errors a TS route layer is expected to recognize and re-word for the end user). ===
create or replace function public.post_journal_entry(
  p_org_id uuid,
  p_entry_date date,
  p_description text,
  p_source_type public.journal_source_type,
  p_source_id uuid,
  p_lines jsonb -- array of {account_id, debit?, credit?, property_id?, owner_id?, tenant_id?, memo?}
)
returns uuid
language plpgsql
as $$
declare
  v_entry_id uuid;
  v_period_status public.accounting_period_status;
  v_total_debit numeric(14, 2);
  v_total_credit numeric(14, 2);
  v_missing_account_lines integer;
  v_invalid_account_lines integer;
begin
  if auth.uid() is null then
    raise exception 'post_journal_entry requires an authenticated user';
  end if;

  if not public.has_org_role(p_org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal entry requires an array of at least two lines';
  end if;

  select count(*) into v_missing_account_lines
  from jsonb_array_elements(p_lines) as line
  where line->>'account_id' is null or line->>'account_id' = '';

  if v_missing_account_lines > 0 then
    raise exception 'chart_of_accounts_incomplete: This organization is missing one or more required ledger accounts. Please contact support.';
  end if;

  select count(*) into v_invalid_account_lines
  from jsonb_array_elements(p_lines) as line
  where not exists (
    select 1 from public.chart_of_accounts c
    where c.id = (line->>'account_id')::uuid and c.org_id = p_org_id
  );

  if v_invalid_account_lines > 0 then
    raise exception 'chart_of_accounts_incomplete: One or more ledger accounts for this transaction could not be found for this organization. Please contact support.';
  end if;

  -- Period lock (ACCOUNTING.md §9): reject outright, never silently adjust the date. A missing
  -- period row is treated as open (no period has been defined/closed for that range yet) --
  -- period locking is an opt-in discipline an org adopts by creating and closing periods, not a
  -- default-deny that would block posting for every org that hasn't set periods up yet.
  select status into v_period_status
  from public.accounting_periods
  where org_id = p_org_id and p_entry_date between period_start and period_end;

  if v_period_status = 'closed' then
    raise exception 'Cannot post to a closed accounting period (entry_date %)', p_entry_date;
  end if;

  select coalesce(sum(coalesce((line->>'debit')::numeric, 0)), 0),
         coalesce(sum(coalesce((line->>'credit')::numeric, 0)), 0)
  into v_total_debit, v_total_credit
  from jsonb_array_elements(p_lines) as line;

  if v_total_debit <> v_total_credit then
    raise exception 'Unbalanced journal entry: total debits % != total credits %', v_total_debit, v_total_credit;
  end if;
  if v_total_debit = 0 then
    raise exception 'A journal entry cannot have zero total value';
  end if;

  insert into public.journal_entries (org_id, entry_date, description, source_type, source_id, created_by, is_reversal)
  values (p_org_id, p_entry_date, p_description, p_source_type, p_source_id, auth.uid(), p_source_type = 'reversal')
  returning id into v_entry_id;

  insert into public.journal_lines (journal_entry_id, account_id, debit, credit, property_id, owner_id, tenant_id, memo)
  select
    v_entry_id,
    (line->>'account_id')::uuid,
    coalesce((line->>'debit')::numeric, 0),
    coalesce((line->>'credit')::numeric, 0),
    nullif(line->>'property_id', '')::uuid,
    nullif(line->>'owner_id', '')::uuid,
    nullif(line->>'tenant_id', '')::uuid,
    line->>'memo'
  from jsonb_array_elements(p_lines) as line;

  return v_entry_id;
end;
$$;

comment on function public.post_journal_entry(uuid, date, text, public.journal_source_type, uuid, jsonb) is
  'The sole write path for journal_entries/journal_lines together (ACCOUNTING.md §3). Validates
   accountant+ role, every line has a real account_id belonging to this org, period-not-closed,
   and SUM(debit)=SUM(credit) before any insert -- rejects the whole entry, never a partial post,
   per ACCOUNTING.md §1. Account-resolution guard added launch-hardening pass 2026-08-26 -- see
   this migration''s own header for the real production bug this closes.';
