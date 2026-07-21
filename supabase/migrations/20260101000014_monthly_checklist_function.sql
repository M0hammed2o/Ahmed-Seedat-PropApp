-- Read-optimised monthly checklist (ARCHITECTURE.md: "computed per property/month, not a
-- separately maintained table, so it can never drift from the underlying bills"). Deliberately
-- NOT `security definer` — it runs with the caller's own privileges, so existing RLS policies
-- on properties/property_expected_categories/documents/bills still apply and a customer can
-- only ever get their own data back from this function, never another user's.
create or replace function public.calculate_monthly_checklist(
  p_property_id uuid,
  p_year integer,
  p_month integer
)
returns table (
  category_id uuid,
  category_label text,
  is_expected boolean,
  document_id uuid,
  bill_id uuid,
  amount_due numeric,
  due_date date,
  status public.bill_status,
  has_proof_of_payment boolean,
  extraction_job_status public.extraction_job_status
)
language sql
stable
as $$
  select
    dc.id as category_id,
    dc.label as category_label,
    coalesce(pec.is_expected, false) as is_expected,
    d.id as document_id,
    b.id as bill_id,
    b.amount_due,
    b.due_date,
    b.status,
    exists (
      select 1 from public.payment_matches pm
      join public.payments pay on pay.id = pm.payment_id
      where pm.bill_id = b.id and pm.status = 'confirmed'
    ) as has_proof_of_payment,
    ej.status as extraction_job_status
  from public.document_categories dc
  left join public.property_expected_categories pec
    on pec.category_id = dc.id and pec.property_id = p_property_id
  left join public.documents d
    on d.category_id = dc.id
    and d.property_id = p_property_id
    and d.billing_year = p_year
    and d.billing_month = p_month
    and d.deleted_at is null
  left join public.bills b on b.document_id = d.id
  left join lateral (
    select ej.status
    from public.extraction_jobs ej
    where ej.document_id = d.id
    order by ej.attempt desc
    limit 1
  ) ej on true
  where dc.is_default
    and (coalesce(pec.is_expected, false) or d.id is not null);
$$;

comment on function public.calculate_monthly_checklist(uuid, integer, integer) is
  'Per-property, per-month checklist rows. Runs with caller privileges (not security definer) so
   RLS still scopes results to the caller''s own property/documents/bills.';
