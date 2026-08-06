-- Audited Super Admin impersonation (master prompt §12.4 — never silent). References
-- admin_users, not yet renamed platform_admin_users — see DECISIONS.md 2026-07-30 for why the
-- rename is deferred to the Milestone 13 Super Admin portal rebuild rather than done here.

create table public.support_access_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users(id),
  org_id uuid not null references public.organizations(id),
  reason text not null check (char_length(reason) >= 10),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  actions_taken jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index support_access_sessions_org_idx on public.support_access_sessions (org_id);
create index support_access_sessions_admin_idx on public.support_access_sessions (admin_user_id);

-- Deliberately no "active session" partial-unique-index constraint limiting one admin to one
-- concurrent session — a support engineer legitimately juggling two client escalations should
-- not be blocked by the schema; that's a UX/workflow concern, not a data-integrity one.

alter table public.support_access_sessions enable row level security;

-- No client policy at all — service-role/is_admin()-gated route handlers only, same pattern as
-- admin_users itself. A support session is never something an org's own staff can see or query,
-- even though it concerns their own org, because the whole point is that support access is
-- something PropertyVault does *to* diagnose an org's account, tracked for PropertyVault's own
-- audit purposes first.
