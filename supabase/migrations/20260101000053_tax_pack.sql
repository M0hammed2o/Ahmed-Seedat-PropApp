-- TASKS.md M14 part 3 / ACCOUNTING.md §7: South African Tax Pack. Computed on demand from
-- journal_lines (not a stored table beyond the audit record of each export, matching the Trial
-- Balance's own "live, computed report" pattern, ACCOUNTING.md §6) -- filtered to the SA tax year
-- (1 March - end of February, evidenced IMG_8047) and Income/Expense account types, grouped
-- per-property and per-account (chart_of_accounts is this ledger's actual category taxonomy --
-- record_expense() already matches an expense's category to a same-named account, so grouping by
-- account IS grouping by category, not a separate mechanism). No SARS classification beyond
-- Income/Expense/account name is invented -- none is documented anywhere in this codebase.

create or replace function public.compute_tax_pack(p_org_id uuid, p_tax_year integer)
returns table(
  property_id uuid,
  account_type public.account_type,
  account_code text,
  account_name text,
  amount numeric
)
language plpgsql
as $$
declare
  v_year_start date;
  v_year_end date;
begin
  if not public.has_org_role(p_org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;
  if p_tax_year < 2020 or p_tax_year > 2100 then
    raise exception 'tax_year must be between 2020 and 2100';
  end if;

  -- SA tax year p_tax_year runs 1 March (p_tax_year - 1) through the last day of February
  -- (p_tax_year) -- computed as "the day before 1 March p_tax_year" rather than hardcoding
  -- Feb 28/29, so leap years resolve correctly without a special case.
  v_year_start := make_date(p_tax_year - 1, 3, 1);
  v_year_end := make_date(p_tax_year, 3, 1) - 1;

  return query
  select
    jl.property_id,
    co.account_type,
    co.code,
    co.name,
    -- Income accounts carry a natural credit balance, Expense accounts a natural debit balance --
    -- this is what makes both "amount" columns a positive, human-readable figure rather than a
    -- signed ledger delta the reader has to mentally flip for one account type.
    (case when co.account_type = 'income' then sum(jl.credit) - sum(jl.debit)
          else sum(jl.debit) - sum(jl.credit)
     end)::numeric(14, 2) as amount
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join public.chart_of_accounts co on co.id = jl.account_id
  where je.org_id = p_org_id
    and co.account_type in ('income', 'expense')
    and je.entry_date between v_year_start and v_year_end
  group by jl.property_id, co.account_type, co.code, co.name
  order by jl.property_id nulls last, co.account_type, co.code;
end;
$$;

comment on function public.compute_tax_pack(uuid, integer) is
  'Live per-property, per-account Income/Expense summary for one SA tax year (1 Mar - end Feb),
   ACCOUNTING.md §7. Not tax advice -- no SARS classification beyond account name is computed.';

-- record_tax_pack_export(): the "audit record" of an actual export/download -- tax_pack_exports
-- itself never stores the computed figures (those are always recomputed live from journal_lines,
-- so they can never drift from the ledger), only that an export happened, when, and by whom (via
-- the row's own created-by-caller RLS context, not a separate column -- matches this table's
-- existing minimal shape from migration 20260101000037, not widened here).
create or replace function public.record_tax_pack_export(p_org_id uuid, p_tax_year integer)
returns uuid
language plpgsql
as $$
declare
  v_export_id uuid;
begin
  if not public.has_org_role(p_org_id, 'accountant') then
    raise exception 'Caller does not have accountant+ rights in this organization';
  end if;

  insert into public.tax_pack_exports (org_id, tax_year)
  values (p_org_id, p_tax_year)
  returning id into v_export_id;

  return v_export_id;
end;
$$;

comment on function public.record_tax_pack_export(uuid, integer) is
  'Logs that a tax pack export happened -- ACCOUNTING.md §7 audit trail. Never stores the computed
   figures themselves (compute_tax_pack() always recomputes live from journal_lines).';
