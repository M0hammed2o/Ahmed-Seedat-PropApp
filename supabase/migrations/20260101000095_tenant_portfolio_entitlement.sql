-- Tenant invitation + entitlement architecture (WORKLOG.md this date). may_create_portfolio()
-- (20260101000094) already blocked a "linked owner only" account from a free
-- create_organization() -- this closes the equivalent gap for a "linked tenant only" account.
-- Same reasoning: someone who entered Proplyst exclusively through an invitation into somebody
-- ELSE's managed resource (an owner invitation OR a tenant invitation) should not get a free ride
-- into running their OWN paid portfolio -- only a genuinely fresh signup (never linked as either)
-- keeps the existing, unrestricted trial-based create_organization() path.
--
-- Re-declared in full (same signature, `create or replace`, matching every prior redefinition of
-- this function back to 20260101000075) -- every branch below is unchanged from 20260101000094's
-- version except the first one, which now also excludes an account linked as a tenant.

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
      -- Never been linked as an owner NOR a tenant anywhere -- an ordinary fresh signup,
      -- completely unaffected by this migration.
      (
        not exists (select 1 from public.owners where owners.user_id = p_user_id)
        and not exists (select 1 from public.tenants where tenants.user_id = p_user_id)
      )
      -- Already runs at least one organization of their own (as any active member, not just
      -- principal).
      or exists (
        select 1 from public.organization_members
        where organization_members.user_id = p_user_id and organization_members.status = 'active'
      )
      -- Explicitly granted (super-admin today; a real billing webhook later).
      or exists (select 1 from public.owner_portfolio_grants where owner_portfolio_grants.user_id = p_user_id)
    );
$$;

comment on function public.may_create_portfolio(uuid) is
  'True unless the caller is a "linked owner or tenant only" account (has an owners.user_id or
   tenants.user_id row somewhere, holds zero active organization_members rows of their own, and
   has no owner_portfolio_grants row) -- see this migration and 20260101000094''s header comments
   for the full reasoning. Called from create_organization() itself (not just the API route) so
   this cannot be bypassed by calling the create_organization RPC directly. Deliberately answers
   only "may this user run their own portfolio" -- tenant PORTAL access itself
   (caller_is_tenant_of_lease() and friends, 20260101000049) is never gated by this function or by
   organization/subscription status at all (PRODUCT DECISION: a tenant must not lose access to
   their own lease/documents because of billing state that has nothing to do with them).';
