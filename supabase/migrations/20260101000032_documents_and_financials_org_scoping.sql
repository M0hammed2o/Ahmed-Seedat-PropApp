-- TASKS.md M11: org-scope the remaining PropVault-era owner_user_id-scoped tables
-- (TECHNICAL_DEBT_REGISTER.md TD-01/TD-02), except `subscriptions`/`subscription_events` --
-- those are excluded deliberately (see note near the end of this file), correcting TD-02's
-- original grouping, which lumped them in with the others as if they needed the same treatment.
--
-- Same expand-only pattern as 20260101000023 (properties): add org_id nullable, migrate RLS to
-- org-scoped, leave owner_user_id physically in place rather than dropping it. The application
-- code cutover (mobile app's document/bill/payment/OCR screens, which currently read/write
-- owner_user_id directly) is explicitly NOT done in this migration -- same reasoning as M5's own
-- scope cut: doing the DB layer and the full mobile-app-code rewrite in one pass risks leaving
-- both half-finished. Tracked as TECHNICAL_DEBT_REGISTER.md TD-21.
--
-- This migration also directly fixes what blocked M5's DROP COLUMN attempt on
-- properties.owner_user_id: document_categories.sql's property_expected_categories policies and
-- documents.sql's insert policy both had cross-table subqueries against properties.owner_user_id.
-- Both are rewritten here to use properties.org_id / has_org_role() instead.

-- === document_categories: custom categories become org-owned, not user-owned ===
alter table public.document_categories add column org_id uuid references public.organizations(id);

-- The pre-existing CHECK constraint (20260101000007) required owner_user_id for any non-default
-- category -- never updated when org_id was added above, so it silently kept blocking every
-- org-scoped custom-category insert. Caught by a real pgTAP run, not by re-reading the migration.
alter table public.document_categories drop constraint document_categories_owner_required_for_custom;
alter table public.document_categories add constraint document_categories_owner_required_for_custom
  check (is_default or org_id is not null);

drop policy if exists "document_categories_select" on public.document_categories;
drop policy if exists "document_categories_insert_own_custom" on public.document_categories;
drop policy if exists "document_categories_delete_own_custom" on public.document_categories;

create policy "document_categories_select"
  on public.document_categories for select
  using (is_default or public.has_org_role(org_id, 'viewer'));

create policy "document_categories_write_agent_plus"
  on public.document_categories for all
  using (not is_default and public.has_org_role(org_id, 'agent'))
  with check (not is_default and public.has_org_role(org_id, 'agent'));

-- Old owner_user_id-scoped unique index is no longer meaningful once custom categories are
-- org-owned (two different orgs should each be free to use the same slug, same as they already
-- could as two different users before).
drop index if exists public.document_categories_owner_slug_idx;
create unique index document_categories_org_slug_idx
  on public.document_categories (org_id, slug) where not is_default;

-- === property_expected_categories: the actual TD-01 blocker fix ===
drop policy if exists "property_expected_categories_all_own" on public.property_expected_categories;

create policy "property_expected_categories_select_org_member"
  on public.property_expected_categories for select
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_expected_categories.property_id and public.has_org_role(p.org_id, 'viewer')
    )
  );

create policy "property_expected_categories_write_agent_plus"
  on public.property_expected_categories for all
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_expected_categories.property_id and public.has_org_role(p.org_id, 'agent')
    )
  )
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_expected_categories.property_id and public.has_org_role(p.org_id, 'agent')
    )
  );

-- === documents: the other TD-01 blocker fix, plus org-scoping ===
alter table public.documents add column org_id uuid references public.organizations(id);
-- Relaxed, not dropped -- same "expand, don't contract yet" reasoning as properties.owner_user_id
-- (20260101000023). Also load-bearing here in a way it wasn't purely cosmetic for properties: an
-- org-scoped insert (agent+ RLS, no single "owner" concept) has no meaningful owner_user_id value
-- to supply, so this NOT NULL would otherwise hard-block every new document from an org-scoped
-- caller -- found and fixed before this migration was committed, not after (verified live via a
-- rolled-back `ALTER TABLE ... DROP COLUMN properties.owner_user_id` that this migration is what
-- actually unblocks).
alter table public.documents alter column owner_user_id drop not null;
create index documents_org_idx on public.documents (org_id) where org_id is not null;

drop policy if exists "documents_select_own" on public.documents;
drop policy if exists "documents_insert_own" on public.documents;
drop policy if exists "documents_update_own" on public.documents;

create policy "documents_select_org_member"
  on public.documents for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "documents_write_agent_plus"
  on public.documents for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

-- === bills ===
alter table public.bills add column org_id uuid references public.organizations(id);
alter table public.bills alter column owner_user_id drop not null;
create index bills_org_status_idx on public.bills (org_id, status) where org_id is not null;

drop policy if exists "bills_select_own" on public.bills;
drop policy if exists "bills_insert_own" on public.bills;
drop policy if exists "bills_update_own" on public.bills;

create policy "bills_select_org_member"
  on public.bills for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "bills_write_agent_plus"
  on public.bills for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

-- === payments ===
alter table public.payments add column org_id uuid references public.organizations(id);
alter table public.payments alter column owner_user_id drop not null;
create index payments_org_idx on public.payments (org_id) where org_id is not null;

drop policy if exists "payments_select_own" on public.payments;
drop policy if exists "payments_insert_own" on public.payments;
drop policy if exists "payments_update_own" on public.payments;

create policy "payments_select_org_member"
  on public.payments for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "payments_write_agent_plus"
  on public.payments for all
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

-- === payment_matches ===
alter table public.payment_matches add column org_id uuid references public.organizations(id);
alter table public.payment_matches alter column owner_user_id drop not null;
create index payment_matches_org_idx on public.payment_matches (org_id) where org_id is not null;

drop policy if exists "payment_matches_select_own" on public.payment_matches;
drop policy if exists "payment_matches_insert_own" on public.payment_matches;
drop policy if exists "payment_matches_update_own" on public.payment_matches;

create policy "payment_matches_select_org_member"
  on public.payment_matches for select
  using (public.has_org_role(org_id, 'viewer'));

-- Retains the original design's cross-table integrity check (payment_id/bill_id must genuinely
-- belong to rows the caller can act on) alongside the new org-role gate, rather than dropping it
-- now that org_id is denormalised -- org_id alone does not prove payment_id/bill_id weren't
-- swapped for another org's rows sharing coincidentally-matching org_id (they can't, since FKs
-- still require them to exist, but this keeps the same-org invariant explicit at the RLS layer
-- too, matching TASKS.md M7's property_owners cross-org guard reasoning).
create policy "payment_matches_write_agent_plus"
  on public.payment_matches for all
  using (
    public.has_org_role(org_id, 'agent')
    and exists (select 1 from public.payments pay where pay.id = payment_id and pay.org_id = payment_matches.org_id)
    and exists (select 1 from public.bills b where b.id = bill_id and b.org_id = payment_matches.org_id)
  )
  with check (
    public.has_org_role(org_id, 'agent')
    and exists (select 1 from public.payments pay where pay.id = payment_id and pay.org_id = payment_matches.org_id)
    and exists (select 1 from public.bills b where b.id = bill_id and b.org_id = payment_matches.org_id)
  );

-- === extraction_jobs / extraction_results: client SELECT only, unchanged (service-role writes) ===
alter table public.extraction_jobs add column org_id uuid references public.organizations(id);
alter table public.extraction_jobs alter column owner_user_id drop not null;
create index extraction_jobs_org_status_idx on public.extraction_jobs (org_id, status) where org_id is not null;

drop policy if exists "extraction_jobs_select_own" on public.extraction_jobs;
create policy "extraction_jobs_select_org_member"
  on public.extraction_jobs for select
  using (public.has_org_role(org_id, 'viewer'));

alter table public.extraction_results add column org_id uuid references public.organizations(id);
alter table public.extraction_results alter column owner_user_id drop not null;
create index extraction_results_org_idx on public.extraction_results (org_id) where org_id is not null;

drop policy if exists "extraction_results_select_own" on public.extraction_results;
create policy "extraction_results_select_org_member"
  on public.extraction_results for select
  using (public.has_org_role(org_id, 'viewer'));

-- === audit_events: expand step only (org_id added, nullable) -- the fuller TD-14 redesign
--     (entity_type/entity_id rename, extended actor_type) is intentionally not done here, to
--     avoid this migration also becoming an audit-log schema redesign. Client SELECT stays
--     scoped to whichever id matches; org-only select added alongside the existing owner-based
--     one rather than replacing it, since owner_user_id is still what every current writer sets. ===
alter table public.audit_events add column org_id uuid references public.organizations(id);
alter table public.audit_events alter column owner_user_id drop not null;
create index audit_events_org_idx on public.audit_events (org_id) where org_id is not null;

create policy "audit_events_select_org_member"
  on public.audit_events for select
  using (org_id is not null and public.has_org_role(org_id, 'viewer'));

-- === subscriptions / subscription_events: deliberately excluded from this migration ===
-- These are the PropVault-era per-user subscription tables, already functionally superseded by
-- organization_subscriptions/subscription_payments (20260101000019). This is not "the same debt
-- as documents/bills/payments, just not yet paid down" -- it's a different question entirely
-- (retire subscriptions/subscription_events outright once nothing reads them, vs. rescope them),
-- and TECHNICAL_DEBT_REGISTER.md TD-02 previously grouped it with the other six tables as if it
-- needed the same org_id-add treatment. Corrected here rather than silently cutting it over to
-- match a debt-register description that was itself imprecise.
