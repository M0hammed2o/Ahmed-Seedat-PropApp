-- Commercial-launch execution plan, Stage 0 (WORKLOG.md/DECISIONS.md this date): property_owners
-- (20260101000022) only ever records the CURRENT ownership split — updating a row silently
-- overwrites whatever percentage was there before, with no record it ever changed. That is a
-- data-integrity landmine specific to this product's actual sales pitch (family/trust co-owners
-- verifying who owned what when a distribution was calculated) — cheap to close now, before any
-- real distribution history exists to protect; expensive to retrofit once it does. This migration
-- adds an append-only, effective-dated ledger fed by a trigger on property_owners, so a later
-- owner_statements generation pass (TASKS.md-tracked follow-up) can look up "what was owner X's
-- share of property Y during period [start, end]" instead of only ever seeing today's value.
--
-- Deliberately NOT wiring this into generate_owner_statements() yet (20260101000052) — that is
-- its own follow-up unit of work once the shared-ownership statement restructuring (outstanding
-- balance, partial payout, reserve line) lands, not bundled into this schema-only step.

create table public.property_ownership_history (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  ownership_pct numeric(5, 2) not null check (ownership_pct > 0 and ownership_pct <= 100),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  changed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create index property_ownership_history_property_idx
  on public.property_ownership_history (property_id, effective_from);
create index property_ownership_history_owner_idx on public.property_ownership_history (owner_id);

-- At most one open (effective_to is null) row per (property_id, owner_id) — "what's true right
-- now for this owner on this property" must be unambiguous.
create unique index property_ownership_history_open_idx
  on public.property_ownership_history (property_id, owner_id)
  where effective_to is null;

alter table public.property_ownership_history enable row level security;

-- Read-only from the client's perspective, same org-membership scoping as property_owners
-- itself (20260101000022) — this table has no org_id column for the same reason property_owners
-- doesn't, so it's reached the same way, through owners.org_id.
create policy "property_ownership_history_select_org_member"
  on public.property_ownership_history for select
  using (
    exists (
      select 1 from public.owners o
      where o.id = property_ownership_history.owner_id and public.has_org_role(o.org_id, 'viewer')
    )
  );

-- No insert/update/delete policy: this table is populated exclusively by the trigger below
-- (security definer, so it writes regardless of the calling role's own RLS grants) — same
-- "never a bare client write" posture as audit_events' immutability trigger (20260101000036).

create or replace function public.track_property_ownership_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.property_ownership_history (property_id, owner_id, ownership_pct, changed_by)
    values (new.property_id, new.owner_id, new.ownership_pct, auth.uid());
  elsif tg_op = 'UPDATE' then
    if new.ownership_pct is distinct from old.ownership_pct then
      update public.property_ownership_history
      set effective_to = now()
      where property_id = new.property_id and owner_id = new.owner_id and effective_to is null;

      insert into public.property_ownership_history (property_id, owner_id, ownership_pct, changed_by)
      values (new.property_id, new.owner_id, new.ownership_pct, auth.uid());
    end if;
  elsif tg_op = 'DELETE' then
    update public.property_ownership_history
    set effective_to = now()
    where property_id = old.property_id and owner_id = old.owner_id and effective_to is null;
  end if;

  return coalesce(new, old);
end;
$$;

comment on function public.track_property_ownership_history() is
  'Populates property_ownership_history from property_owners writes. Only fires an UPDATE-driven
   close+reopen when ownership_pct actually changed (not on unrelated future columns), so a
   no-op update never fabricates a spurious history boundary.';

create trigger track_property_owners_history
  after insert or update or delete on public.property_owners
  for each row execute function public.track_property_ownership_history();
