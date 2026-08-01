-- TASKS.md M18: ai_conversations, ai_messages, portfolio_insights, usage_events, usage_snapshots
-- (DATABASE.md §7-8, AI_ARCHITECTURE.md). LLM vendor selection remains an open decision
-- (AI_ARCHITECTURE.md §3) -- MockLLMProvider carries this milestone, matching M16/M17's pattern.
-- Portfolio Intelligence (§2) is explicitly a rules engine, never an LLM -- its schema and this
-- migration never reference an LLM provider at all.

create type public.ai_message_role as enum ('user', 'assistant');
create type public.portfolio_insight_severity as enum ('info', 'warning', 'urgent');
create type public.usage_type as enum ('storage_bytes', 'email_sent', 'whatsapp_sent', 'ocr_page', 'ai_token');

-- === ai_conversations (AI_ARCHITECTURE.md §1.2) ===
-- One conversation belongs to exactly one org and one user -- there is no cross-org or
-- cross-user conversation.
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now()
);

create index ai_conversations_org_idx on public.ai_conversations (org_id);
create index ai_conversations_user_idx on public.ai_conversations (user_id);

alter table public.ai_conversations enable row level security;

-- Visible/writable only by the user who started it, not the rest of the org -- a chat may
-- contain sensitive free-text the user typed, unlike org-shared tables like announcements.
create policy "ai_conversations_all_own"
  on public.ai_conversations for all
  using (user_id = auth.uid() and public.has_org_role(org_id, 'viewer'))
  with check (user_id = auth.uid() and public.has_org_role(org_id, 'viewer'));

-- === ai_messages (AI_ARCHITECTURE.md §1.2, §1.5) ===
create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role public.ai_message_role not null,
  content text not null,
  staged_changes jsonb,
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);

alter table public.ai_messages enable row level security;

-- Scoped via the parent conversation's own owner (ai_messages has no user_id of its own, matching
-- AI_ARCHITECTURE.md §1.2's exact shape). The API route writes through the acting user's own
-- session, never service-role (§1.4's hard requirement) -- this policy is what actually enforces
-- that a bug in the route handler can't leak one user's conversation into another's.
create policy "ai_messages_all_via_own_conversation"
  on public.ai_messages for all
  using (
    exists (
      select 1 from public.ai_conversations c
      where c.id = ai_messages.conversation_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.ai_conversations c
      where c.id = ai_messages.conversation_id and c.user_id = auth.uid()
    )
  );

-- === portfolio_insights (AI_ARCHITECTURE.md §2) -- rules-engine output, never LLM-generated ===
create table public.portfolio_insights (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  insight_type text not null check (char_length(insight_type) between 1 and 100),
  message text not null,
  data_source jsonb not null,
  severity public.portfolio_insight_severity not null,
  generated_at timestamptz not null default now(),
  dismissed_at timestamptz
);

create index portfolio_insights_org_idx on public.portfolio_insights (org_id, dismissed_at);

alter table public.portfolio_insights enable row level security;

-- Select for any org staff; dismissing is the one legitimate client write, matching
-- notifications' read-receipt pattern -- everything else is written by the rules-evaluation job
-- (service-role), never a client.
create policy "portfolio_insights_select_org"
  on public.portfolio_insights for select
  using (public.has_org_role(org_id, 'viewer'));

create policy "portfolio_insights_dismiss_org"
  on public.portfolio_insights for update
  using (public.has_org_role(org_id, 'viewer'))
  with check (public.has_org_role(org_id, 'viewer'));

-- === usage_events / usage_snapshots (DATABASE.md §7) ===
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  usage_type public.usage_type not null,
  quantity numeric not null check (quantity >= 0),
  related_entity_type text,
  related_entity_id uuid,
  recorded_at timestamptz not null default now()
);

create index usage_events_org_period_idx on public.usage_events (org_id, usage_type, recorded_at);

alter table public.usage_events enable row level security;

create policy "usage_events_select_org"
  on public.usage_events for select
  using (public.has_org_role(org_id, 'viewer'));
-- No client insert/update/delete policy -- written exclusively by server-side subsystems
-- (service-role), same reasoning as audit_events.

create table public.usage_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  period date not null,
  usage_type public.usage_type not null,
  total_quantity numeric not null default 0,
  computed_at timestamptz not null default now(),
  unique (org_id, period, usage_type)
);

create index usage_snapshots_org_idx on public.usage_snapshots (org_id, period);

alter table public.usage_snapshots enable row level security;

create policy "usage_snapshots_select_org"
  on public.usage_snapshots for select
  using (public.has_org_role(org_id, 'viewer'));
-- No client write policy -- populated exclusively by the scheduled rollup job (service-role).
