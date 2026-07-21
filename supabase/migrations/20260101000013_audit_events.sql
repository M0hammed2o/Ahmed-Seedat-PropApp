-- Append-only. No update/delete policy exists anywhere in this migration set for this table —
-- not even for the owning customer — so it can serve as a trustworthy audit trail.
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  actor_type public.actor_type not null,
  action text not null,
  target_type text not null,
  target_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index audit_events_owner_idx on public.audit_events (owner_user_id);
create index audit_events_target_idx on public.audit_events (target_type, target_id);
create index audit_events_created_at_idx on public.audit_events (created_at);

alter table public.audit_events enable row level security;

create policy "audit_events_select_own"
  on public.audit_events for select
  using (owner_user_id = auth.uid());

-- Inserts happen via service-role (admin actions, server-confirmed payment matches) or via a
-- security-definer RPC in a later phase for customer-initiated audited actions; no direct
-- client insert policy in Phase 1 to avoid a client forging an audit entry.
