-- Portfolio Intelligence: which organisations have anything to evaluate, and which inputs each has
-- (docs/UTILITIES_FINAL_TEST_RESULTS.md, the daily-jobs timeout). reconcilePortfolioInsights() reads exactly these
-- inputs; an organisation with none of them and no undismissed insight produces no insight and has nothing to
-- auto-resolve, so skipping it changes nothing, and an input an organisation does not have need not be queried.
-- Previously every organisation cost 9+ HTTP round trips, and the 500-org cap always took the SAME first 500.

drop function if exists public.portfolio_intelligence_candidate_orgs();

create function public.portfolio_intelligence_candidate_orgs()
returns table (
  org_id uuid,
  has_rent_overdue boolean,
  has_rent_pending boolean,
  has_leases boolean,
  has_tickets boolean,
  has_invoices boolean,
  has_budgets boolean,
  has_meters boolean,
  has_insights boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select * from (
    select
      o.id,
      exists (select 1 from public.rent_schedules r where r.org_id = o.id and r.status = 'overdue'),
      -- the same windows the rules apply (UTC dates, as in portfolioIntelligence.ts): due within 7 days,
      -- ending within 90 days, at least one day past due. Each is a superset of what the rule can flag.
      exists (select 1 from public.rent_schedules r where r.org_id = o.id and r.status = 'pending'
                and r.due_date between (now() at time zone 'utc')::date and (now() at time zone 'utc')::date + 7),
      exists (select 1 from public.leases l where l.org_id = o.id and l.status = 'active'
                and l.end_date between (now() at time zone 'utc')::date and (now() at time zone 'utc')::date + 90),
      exists (select 1 from public.maintenance_tickets t where t.org_id = o.id and t.status in ('to_do', 'in_progress', 'pending_approval')),
      exists (select 1 from public.invoices i where i.org_id = o.id and i.status <> 'paid' and i.voided_at is null
                and i.period < (now() at time zone 'utc')::date),
      exists (select 1 from public.property_budgets b where b.org_id = o.id and b.month = date_trunc('month', now())::date),
      exists (select 1 from public.utility_meters m where m.org_id = o.id and m.active),
      exists (select 1 from public.portfolio_insights p where p.org_id = o.id and p.dismissed_at is null)
    from public.organizations o
    where o.status <> 'archived'
  ) c (org_id, has_rent_overdue, has_rent_pending, has_leases, has_tickets, has_invoices, has_budgets, has_meters, has_insights)
  where has_rent_overdue or has_rent_pending or has_leases or has_tickets or has_invoices or has_budgets or has_meters or has_insights
  order by org_id;
$$;

revoke all on function public.portfolio_intelligence_candidate_orgs() from public, anon, authenticated;
grant execute on function public.portfolio_intelligence_candidate_orgs() to service_role;

comment on function public.portfolio_intelligence_candidate_orgs() is
  'Service-role only: organisations with at least one Portfolio Intelligence rule input or an undismissed insight, with which inputs each has.';
