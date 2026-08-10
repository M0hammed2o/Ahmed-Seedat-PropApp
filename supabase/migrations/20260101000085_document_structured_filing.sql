-- Shared-access architecture pass (WORKLOG.md this date), Phase 4: structured document filing.
-- `documents` already had org_id/property_id/category_id/billing_year/billing_month/lease_id --
-- this adds only the columns genuinely missing for "Property -> Category -> Period -> Context"
-- (unit/tenant/maintenance context) plus uploaded_by, which nothing currently tracks (the upload
-- route never set owner_user_id post-org-cutover -- confirmed by reading it, not assumed). All
-- nullable, all additive; a document with none of them set is exactly as valid as it is today.

alter table public.documents
  add column unit_id uuid references public.units(id) on delete set null,
  add column tenant_id uuid references public.tenants(id) on delete set null,
  add column maintenance_ticket_id uuid references public.maintenance_tickets(id) on delete set null,
  add column uploaded_by uuid references auth.users(id) on delete set null;

create index documents_unit_idx on public.documents (unit_id) where unit_id is not null;
create index documents_tenant_idx on public.documents (tenant_id) where tenant_id is not null;
create index documents_maintenance_ticket_idx on public.documents (maintenance_ticket_id) where maintenance_ticket_id is not null;
-- Property/category/year/month is the exact folder-navigation query shape (Property -> Category
-- -> Year -> Month) the new UI will run.
create index documents_folder_nav_idx
  on public.documents (property_id, category_id, billing_year, billing_month);

comment on column public.documents.unit_id is
  'Optional -- set when a document belongs to a specific unit (e.g. a unit-level lease document)
   rather than the property as a whole. Never required: property_id alone remains sufficient.';
comment on column public.documents.tenant_id is
  'Optional -- set when a document is specifically about a tenant (e.g. an ID copy, a signed
   addendum) rather than the property/unit generally.';
comment on column public.documents.maintenance_ticket_id is
  'Optional -- links a document (quotation/invoice/proof of payment) to the maintenance ticket it
   supports, per the maintenance-issue -> job -> quotation -> invoice -> proof-of-payment document
   chain.';
comment on column public.documents.uploaded_by is
  'The authenticated user who uploaded this document. Nullable because historical rows predate
   this column; every new upload should set it going forward (apps/admin/app/api/v1/documents,
   properties/:id/photos).';

-- New system categories -- additive only, reusing every existing one where it already covers the
-- brief's list (Municipal/Utilities -> water+electricity already exist; Leases -> rental_documents
-- already exists; Rates & Taxes/Insurance/Compliance/Maintenance/Other already exist). Only the
-- genuinely missing ones are added here.
insert into public.document_categories (slug, label, is_default) values
  ('inspections', 'Inspections', true),
  ('tenant_documents', 'Tenant Documents', true),
  ('owner_documents', 'Owner Documents', true),
  ('banking', 'Banking', true),
  ('property_acquisition', 'Property Acquisition', true),
  ('property_sale', 'Property Sale', true),
  ('legal', 'Legal', true),
  ('accounting', 'Accounting', true)
on conflict do nothing;
