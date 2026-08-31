-- Overnight V1 completion pass (WORKLOG.md this date), Part A gap 4: tenant detail page has
-- always shown a truthful "Not captured yet" emergency-contact placeholder (properties/[id]/
-- page.tsx's own prior comment confirms no such field ever existed: "public.tenants has no
-- emergency-contact field"). Audited the full migration history (grep "alter table
-- public.tenants" across every migration) and confirmed this is still true -- genuinely missing
-- schema, not a UI gap. Minimal, nullable, additive: three plain text columns, no new table --
-- a name/phone/relationship triple is exactly what the existing UI copy (and the Lovable
-- reference this page was built from) already implies, nothing more speculative than that.

alter table public.tenants
  add column emergency_contact_name text,
  add column emergency_contact_phone text,
  add column emergency_contact_relationship text;

comment on column public.tenants.emergency_contact_name is
  'Optional. Captured via tenant edit -- staff-entered, never required for an internally-managed tenant.';
comment on column public.tenants.emergency_contact_phone is 'Optional, free-text (no format enforced, matches tenants.phone).';
comment on column public.tenants.emergency_contact_relationship is 'Optional, free-text (e.g. "Spouse", "Sister", "Parent").';
