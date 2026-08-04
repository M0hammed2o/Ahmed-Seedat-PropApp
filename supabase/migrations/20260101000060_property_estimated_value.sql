-- Adds an optional, landlord/staff-captured property valuation, used by the Owner Dashboard's
-- Portfolio Value card (UI_INTEGRATION_PLAN.md Lovable-adoption batch, 2026-08-04). Lovable's own
-- dashboard shows a "Portfolio value" figure with no real field behind it anywhere in this
-- schema -- per the explicit instruction not to fabricate that number, it is now backed by a real,
-- optional, manually-captured column instead of either inventing a figure or deleting the card.
--
-- Nullable by design: valuation is opinion/appraisal, not something PropertyVault can derive on
-- its own (no valuation/appraisal integration exists or is planned). A property with no value
-- captured contributes nothing to the portfolio total -- the dashboard shows a truthful
-- "not available" state rather than treating an absent value as zero.
--
-- No new RLS policy needed: this column is covered by the existing `properties_write_agent_plus`
-- policy (FOR ALL, `has_org_role(org_id, 'agent')`) -- Postgres RLS is row-level, not
-- column-level, and that policy already governs every UPDATE on this table, matching the
-- instruction's own "authorised landlords or staff" requirement exactly (same floor as every
-- other property write, not a new permission level).
alter table public.properties
  add column estimated_value numeric(14, 2) check (estimated_value is null or estimated_value >= 0),
  add column estimated_value_as_of date,
  add column estimated_value_updated_by uuid references auth.users(id) on delete set null;

comment on column public.properties.estimated_value is
  'Optional, manually captured current estimated value (ZAR). Never computed/derived -- landlord or staff opinion, entered explicitly. Null means "not captured", not zero.';
comment on column public.properties.estimated_value_as_of is
  'The date the captured value is understood to reflect (e.g. an appraisal date), not the row-edit timestamp -- lets staff enter a valuation from a report dated earlier than today.';
