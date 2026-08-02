-- Product-scope correction (2026-08-01): PropertyVault V1 is not a tenant-screening platform.
-- Landlords/staff review applicants and documents directly and decide manually. This migration
-- expands (never removes) the existing applications schema to support that simplified flow:
-- 'reviewing' (a staff member has started looking at it) and 'withdrawn' (applicant pulled out --
-- previously not representable at all) join the existing submitted/screening/decided values.
-- 'screening' and the screening_status/screening_consent_at columns are left fully intact and
-- dormant (ROADMAP.md) -- not removed, not exposed in the V1 UI, available if screening is ever
-- built out as a real V2 feature.

alter type public.application_status add value if not exists 'reviewing';
alter type public.application_status add value if not exists 'withdrawn';

-- Internal staff notes -- the "Landlord reviews applicant and documents, records notes" step of
-- the simplified V1 workflow. Nullable, no default; POST /api/v1/applications/:id/notes is the
-- only writer.
alter table public.applications add column notes text;

comment on column public.applications.notes is
  'Internal landlord/staff notes captured while reviewing an application. Never shown to the
   applicant -- there is no tenant/applicant portal in V1. Set via POST /api/v1/applications/:id/notes,
   which also transitions status submitted -> reviewing on first save.';
