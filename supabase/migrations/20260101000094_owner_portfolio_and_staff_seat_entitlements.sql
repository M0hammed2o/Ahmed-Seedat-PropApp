-- Owner subscription / staff seat entitlement architecture (WORKLOG.md this date). Business
-- model change: OWNER ACCOUNT, STAFF ACCOUNT, and SUBSCRIPTION/SEAT ENTITLEMENT are three
-- separate concepts, not one generic user type. This migration adds the smallest schema needed
-- to express that split, reusing the existing org-level billing shape (`plans.feature_limits`,
-- `organization_subscriptions`) rather than building a second, parallel billing system -- neither
-- `plans.feature_limits.maxStaff` (seeded 20260101000075) nor `.maxProperties` had ever been read
-- by application code before this migration; this is the first real consumer of both.
--
-- Two genuinely new concepts:
--
-- 1. "Linked owner without a portfolio subscription." An owner invited into someone else's
--    org (`owners.user_id` set via accept_owner_invitation/link_owner_to_self, migrations
--    20260101000083/88) has always been allowed to view their shared property with zero
--    organization_members row anywhere (owner_portal_read_access, 20260101000072) -- that already
--    matches "an owner can legally own a share of a property without a paid subscription."  What
--    was previously UNRESTRICTED is that same linked-owner-only account calling
--    create_organization() to spin up their OWN portfolio for free. `owner_portfolio_grants`
--    is the explicit, minimal allow-list a super-admin (or, later, a real payment webhook)
--    populates to unlock exactly that one transition -- it is NOT a general subscription-status
--    table (org-level subscription status already exists and is unchanged by this migration) and
--    it is NOT consulted for any user who already holds an active organization_members row
--    anywhere (see may_create_portfolio() below) -- a normal signup with zero prior owner
--    relationship is completely unaffected by this migration.
--
-- 2. "Staff seat" -- a billable slot on an ORGANIZATION's subscription (never the staff member's
--    own), counted from `organization_members` rows with role <> 'principal' (the principal is
--    the paying owner, not a seat) and limited by the org's current plan's
--    `feature_limits.maxStaff` (null = unlimited, the same null-means-unlimited convention
--    `maxProperties` already uses on the very same jsonb column).

create table public.owner_portfolio_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now()
);

comment on table public.owner_portfolio_grants is
  'Explicit allow-list unlocking create_organization() for a user whose only relationship to the
   product so far is a linked owner record in someone else''s org (see may_create_portfolio()).
   Populated manually by a super-admin today (POST /api/v1/admin/owner-portfolio-grants); a real
   payment provider can populate it the same way once billing is implemented. Not consulted for
   any user who already has an active organization_members row anywhere.';

alter table public.owner_portfolio_grants enable row level security;

-- Self-read only, so the owner-portal UI can show "you have been approved to start your own
-- portfolio" -- no client insert/update/delete policy at all (service-role/super-admin only),
-- matching billing_events'/subscription_events' existing "server-side subsystems only" pattern.
create policy "owner_portfolio_grants_select_self"
  on public.owner_portfolio_grants for select
  using (user_id = auth.uid());

-- === may_create_portfolio(): the one new authorization primitive ===
-- security definer: needs to read `owners`/`organization_members` regardless of the calling
-- user's own row-level visibility into those tables (an owner has no RLS-granted read access to
-- organization_members rows that aren't their own), same reasoning as has_org_role()/
-- caller_is_tenant_of_lease() already established elsewhere in this schema.
create or replace function public.may_create_portfolio(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    p_user_id is not null
    and (
      -- Never been linked as an owner anywhere -- an ordinary fresh signup, completely
      -- unaffected by this migration.
      not exists (select 1 from public.owners where owners.user_id = p_user_id)
      -- Already runs at least one organization of their own (as any active member, not just
      -- principal -- staff of an existing org creating a second, personally-owned org is not the
      -- scenario this migration restricts).
      or exists (
        select 1 from public.organization_members
        where organization_members.user_id = p_user_id and organization_members.status = 'active'
      )
      -- Explicitly granted (super-admin today; a real billing webhook later).
      or exists (select 1 from public.owner_portfolio_grants where owner_portfolio_grants.user_id = p_user_id)
    );
$$;

comment on function public.may_create_portfolio(uuid) is
  'True unless the caller is a "linked owner only" account (has an owners.user_id row somewhere,
   holds zero active organization_members rows of their own, and has no owner_portfolio_grants
   row) -- see the migration header comment for the full reasoning. Called from
   create_organization() itself (not just the API route) so this cannot be bypassed by calling
   the create_organization RPC directly.';

-- === Staff seat accounting ===
create or replace function public.org_active_billable_staff_count(p_org_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
  from public.organization_members
  where organization_members.org_id = p_org_id
    and organization_members.status = 'active'
    and organization_members.role <> 'principal';
$$;

comment on function public.org_active_billable_staff_count(uuid) is
  'Active staff (any role except principal -- the principal is the paying owner, not a seat).
   Deliberately a live count, not a stored column, so removing a member frees the seat
   immediately (STAFF SEAT OWNERSHIP: "Mohammed''s billable staff-seat quantity can later be
   reduced" -- there is nothing to reduce here beyond this count going down on its own).';

create or replace function public.org_staff_seat_limit(p_org_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select (p.feature_limits ->> 'maxStaff')::integer
  from public.organization_subscriptions os
  join public.plans p on p.id = os.plan_id
  where os.org_id = p_org_id
  order by os.current_period_start desc
  limit 1;
$$;

comment on function public.org_staff_seat_limit(uuid) is
  'The org''s current plan''s feature_limits.maxStaff (null = unlimited, matching the existing
   maxProperties null-means-unlimited convention on the same jsonb column -- seeded
   20260101000075, never previously read by any query). Returns null (unlimited) for an org with
   no organization_subscriptions row at all, or a plan with no maxStaff key -- deliberately
   permissive so every existing organization/test fixture, none of which populate
   organization_subscriptions, is completely unaffected by this migration (no existing staff
   invite becomes newly blocked).';

create or replace function public.available_staff_seats(p_org_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select
    case
      when public.org_staff_seat_limit(p_org_id) is null then null
      else public.org_staff_seat_limit(p_org_id) - public.org_active_billable_staff_count(p_org_id)
    end;
$$;

comment on function public.available_staff_seats(uuid) is
  'null = unlimited. May be zero or negative once the limit is reached or the org''s plan changed
   to a smaller seat allowance after staff were already invited -- callers treat "> 0 or null" as
   "may invite another," never "must equal a specific positive number."';

-- === Enforce may_create_portfolio() inside create_organization() itself ===
-- Re-declared in full (same signature, `create or replace`, matching every prior redefinition of
-- this function back to 20260101000021) -- every line below the new check is unchanged from
-- 20260101000075's version. This is the actual, unbypassable enforcement point: create_organization
-- is called directly via `supabase.rpc('create_organization', ...)` from the session-bound client
-- (apps/admin/app/api/v1/organizations/route.ts), which any authenticated client could call
-- directly over PostgREST regardless of what the Next.js route checks first.
create or replace function public.create_organization(
  p_legal_name text,
  p_org_type public.organization_type default 'owner_managed'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'create_organization requires an authenticated user';
  end if;

  if not public.may_create_portfolio(auth.uid()) then
    raise exception 'owner_subscription_required: an active Proplyst owner subscription is required to create your own portfolio.';
  end if;

  insert into public.organizations (legal_name, org_type, trial_ends_at)
  values (p_legal_name, p_org_type, now() + interval '30 days')
  returning id into v_org_id;

  insert into public.organization_members (org_id, user_id, role, status, joined_at)
  values (v_org_id, auth.uid(), 'principal', 'active', now());

  perform public.seed_chart_of_accounts(v_org_id);

  return v_org_id;
end;
$$;

-- === Enforce available_staff_seats() in the organization_invites INSERT policy ===
-- Unbypassable backstop matching the RLS-is-the-real-enforcement pattern used throughout this
-- schema -- POST /api/v1/organizations/:orgId/invites (apps/admin) still pre-checks this itself
-- for a friendlier error message (same "defense in depth, nicer message at the API layer" split
-- already used there for MAX_INVITABLE_ROLE_FOR), but a client inserting into
-- organization_invites directly over PostgREST (the existing insert policy's own threat model,
-- 20260101000026) must be stopped here too.
drop policy if exists "organization_invites_insert_manager_plus" on public.organization_invites;

create policy "organization_invites_insert_manager_plus"
  on public.organization_invites for insert
  with check (
    public.has_org_role(org_id, 'manager')
    and (
      public.available_staff_seats(org_id) is null
      or public.available_staff_seats(org_id) > 0
    )
  );
