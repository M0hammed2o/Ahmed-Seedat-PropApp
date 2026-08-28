-- Referral attribution (V1 launch-completion pass, WORKLOG.md this date). Platform-admin-only
-- data: which (if any) referral partner brought in a given organization at signup, captured once
-- at org-creation time by the service-role client (see POST /api/v1/organizations) -- never
-- blocking or failing signup on a missing/invalid code, and never trusted from a raw client write.
-- Deliberately NOT a commission/payout engine, partner portal, or commission-statement system --
-- those are explicitly V1.1 scope. This is attribution bookkeeping only.

create table public.referral_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Referral codes are not secrets (safe to log/expose) but must be unique and case-normalized.
  -- Normalized (trim + lowercase) by the application at write time, same "store already-clean"
  -- convention as e.g. citext-backed email columns elsewhere in this schema -- the check
  -- constraint below is defense-in-depth against a raw insert bypassing that normalization, not
  -- the primary enforcement mechanism.
  referral_code text not null check (referral_code = lower(trim(referral_code))),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create unique index referral_partners_code_idx on public.referral_partners (referral_code);

comment on table public.referral_partners is
  'Platform-admin-managed list of referral partners and their unique signup codes. Referral codes
   are not secrets -- safe to expose/log -- but are stored case-normalized (lower+trim) and unique.
   No commission/payout data lives here; V1.1 scope explicitly excludes that.';

alter table public.referral_partners enable row level security;
-- No policies for anon/authenticated at all -- platform-admin-only access happens exclusively via
-- the service-role client through gated /api/v1/admin/referral-partners routes. A deliberately
-- empty policy set means RLS default-denies all client access, matching
-- public.admin_users/platform_admin_users' own "deliberately empty policy set" isolation pattern
-- (see 20260101000003_admin_users.sql).

create table public.organization_referral_attributions (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  referral_partner_id uuid references public.referral_partners(id),
  referral_code_used text,
  fallback_referrer_name text,
  attributed_at timestamptz not null default now(),
  -- Set only by an explicit Platform Admin correction (PATCH
  -- /api/v1/admin/referral-attributions/:orgId) after the fact -- never by the original signup
  -- insert. Attribution is captured once at signup and is not casually changeable afterward.
  corrected_by uuid references auth.users(id),
  corrected_at timestamptz
);

create index organization_referral_attributions_partner_idx
  on public.organization_referral_attributions (referral_partner_id);

comment on table public.organization_referral_attributions is
  'One row per organization, created once at signup (POST /api/v1/organizations, service-role
   insert, ON CONFLICT (org_id) DO NOTHING so a retried request cannot duplicate or silently
   overwrite it). referral_partner_id is null when the code was missing/unknown/inactive at
   signup time -- fallback_referrer_name carries a free-text name in that case. Only ever changed
   afterward via an explicit Platform Admin correction, which stamps corrected_by/corrected_at.';

alter table public.organization_referral_attributions enable row level security;
-- Same isolation model as referral_partners above -- no anon/authenticated policies at all;
-- service-role only, gated at the API layer by requireAdminRoleOrRespond('super_admin').
