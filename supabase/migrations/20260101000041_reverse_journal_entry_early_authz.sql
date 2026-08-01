-- Minor hardening found while reviewing 20260101000040's resolve_whatsapp_sender() disclosure
-- gap: reverse_journal_entry() (20260101000035) is also `security definer`, and its initial
-- `select ... into v_original from journal_entries where id = p_entry_id` runs before any
-- authorization check -- security definer bypasses RLS, so this SELECT succeeds for an entry in
-- ANY org, not just one the caller has rights in. The subsequent `already reversed`/`is itself a
-- reversal` checks would then leak that boolean state about a foreign org's entry via the
-- exception message, before the actual reversal attempt fails (correctly) inside
-- post_journal_entry()'s own has_org_role() check.
--
-- Severity assessment: low, not urgent. Unlike resolve_whatsapp_sender()'s phone-number lookup
-- (practically enumerable input, no caller-scoping at all), this requires the caller to already
-- know or guess a specific journal_entries UUID (122 bits of randomness, not practically
-- guessable) and to already hold accountant+ rights in at least one org. Fixed anyway, on the
-- same "security takes priority over speed" basis the rest of this session has applied
-- consistently -- a known gap left "for later" is still a gap.
create or replace function public.reverse_journal_entry(
  p_entry_id uuid,
  p_reversal_entry_date date default current_date,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.journal_entries%rowtype;
  v_lines jsonb;
  v_reversal_id uuid;
begin
  select * into v_original from public.journal_entries where id = p_entry_id;
  if not found then
    raise exception 'Journal entry not found (or not visible to the caller)';
  end if;

  -- Authorization check moved before any branch that would otherwise reveal state about an
  -- entry the caller has no rights to -- a caller without accountant+ in v_original.org_id gets
  -- the identical generic "not found" response whether the entry doesn't exist at all or simply
  -- isn't theirs to act on, matching API_SPEC.md §0's "a resource in another org 404s" principle
  -- applied at the database layer.
  if not public.has_org_role(v_original.org_id, 'accountant') then
    raise exception 'Journal entry not found (or not visible to the caller)';
  end if;

  if v_original.reversed_by_entry_id is not null then
    raise exception 'Journal entry % has already been reversed', p_entry_id;
  end if;
  if v_original.is_reversal then
    raise exception 'Journal entry % is itself a reversal and cannot be reversed again -- post a new correcting entry instead', p_entry_id;
  end if;

  select jsonb_agg(jsonb_build_object(
    'account_id', account_id,
    'debit', credit,
    'credit', debit,
    'property_id', property_id,
    'owner_id', owner_id,
    'tenant_id', tenant_id,
    'memo', coalesce(p_reason, 'Reversal of entry ' || p_entry_id::text)
  ))
  into v_lines
  from public.journal_lines
  where journal_entry_id = p_entry_id;

  v_reversal_id := public.post_journal_entry(
    v_original.org_id,
    p_reversal_entry_date,
    coalesce(p_reason, 'Reversal of: ' || coalesce(v_original.description, p_entry_id::text)),
    'reversal',
    p_entry_id,
    v_lines
  );

  update public.journal_entries set reversed_by_entry_id = v_reversal_id where id = p_entry_id;

  return v_reversal_id;
end;
$$;
