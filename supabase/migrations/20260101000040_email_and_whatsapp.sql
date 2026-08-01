-- TASKS.md M16 (Email) + M17 (WhatsApp) schema: email_messages, email_suppressions,
-- whatsapp_messages, verified_phone_numbers, whatsapp_conversation_state (DATABASE.md §7).
-- Real provider accounts are external-service blockers this session cannot provision
-- (EMAIL.md §2/§9, WHATSAPP.md §5/Unresolved) -- schema, provider interfaces, and mock
-- implementations are the achievable, fully-real scope per both documents' own framing.

create type public.message_direction as enum ('inbound', 'outbound');
create type public.email_status as enum ('queued', 'sent', 'delivered', 'bounced', 'failed');
create type public.email_suppression_reason as enum ('hard_bounce', 'spam_complaint');
create type public.whatsapp_status as enum ('queued', 'sent', 'delivered', 'read', 'failed');
create type public.verified_phone_entity_type as enum ('tenant', 'owner', 'organization_member');
create type public.whatsapp_conversation_state_type as enum ('none', 'awaiting_context_selection');

-- === email_messages ===
create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  direction public.message_direction not null default 'outbound',
  to_address citext not null,
  subject text not null,
  template_name text not null,
  related_entity_type text,
  related_entity_id uuid,
  status public.email_status not null default 'queued',
  provider_message_id text,
  created_at timestamptz not null default now()
);

create index email_messages_org_idx on public.email_messages (org_id, status);
create index email_messages_related_idx on public.email_messages (related_entity_type, related_entity_id)
  where related_entity_type is not null;
create unique index email_messages_provider_id_idx on public.email_messages (provider_message_id)
  where provider_message_id is not null;

alter table public.email_messages enable row level security;

create policy "email_messages_select_org_member"
  on public.email_messages for select
  using (public.has_org_role(org_id, 'viewer'));

-- No client insert/update/delete policy at all -- EMAIL.md §2/§8: templates render server-side
-- only, status transitions come only from the real provider webhook (never client-inferred), so
-- the only legitimate writers are the send function and the webhook handler, both service-role.

-- === email_suppressions ===
create table public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email_address citext not null,
  reason public.email_suppression_reason not null,
  suppressed_at timestamptz not null default now(),
  unique (org_id, email_address)
);

alter table public.email_suppressions enable row level security;

create policy "email_suppressions_select_org_member"
  on public.email_suppressions for select
  using (public.has_org_role(org_id, 'viewer'));

-- Same reasoning: EMAIL.md §7 -- written only by the email-provider webhook handler on a
-- bounced/spam-complaint event, no client write path.

-- === whatsapp_messages ===
create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  direction public.message_direction not null,
  to_number text not null,
  from_number text not null,
  related_entity_type text,
  related_entity_id uuid,
  template_name text,
  body text,
  status public.whatsapp_status not null default 'queued',
  provider_message_id text,
  created_at timestamptz not null default now()
);

create index whatsapp_messages_org_idx on public.whatsapp_messages (org_id, status);
create unique index whatsapp_messages_provider_id_idx on public.whatsapp_messages (provider_message_id)
  where provider_message_id is not null;

alter table public.whatsapp_messages enable row level security;

create policy "whatsapp_messages_select_org_member"
  on public.whatsapp_messages for select
  using (public.has_org_role(org_id, 'viewer'));

-- No client write path -- WHATSAPP.md §2: "nothing outside the dispatcher can originate a
-- WhatsApp send," and inbound rows come only from the (service-role) webhook handler.

-- === verified_phone_numbers -- "No client RLS policy" per DATABASE.md §7's own text ===
create table public.verified_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entity_type public.verified_phone_entity_type not null,
  entity_id uuid not null,
  phone_number_e164 text not null,
  verified_at timestamptz not null default now(),
  verification_method text not null default 'otp' check (verification_method = 'otp'),
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, phone_number_e164)
);

create index verified_phone_numbers_phone_idx on public.verified_phone_numbers (phone_number_e164);

alter table public.verified_phone_numbers enable row level security;
-- Deliberately zero policies -- same privileged-table pattern as admin_users/journal_entries'
-- insert-only-plus-trigger/support_access_sessions: written only by the (not-yet-designed,
-- WHATSAPP.md Unresolved) OTP-verification server flow, read only by the service-role webhook
-- handler's resolve_whatsapp_sender() below. The whole point (DATABASE.md §7) is resolving a
-- phone number to an org before any org context exists, which is inherently a service-role-only
-- operation -- RLS-scoping this table to "your own org" would be a contradiction in terms.

-- === whatsapp_conversation_state -- also zero client policies ===
create table public.whatsapp_conversation_state (
  phone_number_e164 text primary key,
  state public.whatsapp_conversation_state_type not null default 'none',
  candidate_entities jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);

alter table public.whatsapp_conversation_state enable row level security;

-- === resolve_whatsapp_sender(): step 2 of WHATSAPP.md §1.2's resolution algorithm, the single
--     highest-security-value piece of this milestone -- "identity is resolved only from verified
--     phone numbers on file, never from message content." security definer because
--     verified_phone_numbers has zero RLS policies for any client role (by design, above); this
--     function is the one sanctioned read path, matching the "service-role query, unscoped by
--     org, exactly because org is what we're trying to find" reasoning verbatim from the spec.
--     Branching into UNAUTHENTICATED/RESOLVED/AMBIGUOUS (§1.2) is application logic (the webhook
--     handler) built against this function's result set -- 0 rows, 1 row, or 2+ rows -- not
--     encoded here, since the webhook handler itself needs a real BSP account to exist at all.
create or replace function public.resolve_whatsapp_sender(p_phone_number_e164 text)
returns table (org_id uuid, entity_type public.verified_phone_entity_type, entity_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select org_id, entity_type, entity_id
  from public.verified_phone_numbers
  where phone_number_e164 = p_phone_number_e164;
$$;

comment on function public.resolve_whatsapp_sender(text) is
  'WHATSAPP.md §1.2 step 2. Returns every verified (org_id, entity_type, entity_id) match for a
   phone number -- 0 rows = UNAUTHENTICATED, 1 row = RESOLVED, 2+ rows = AMBIGUOUS. Caller (the
   webhook handler) must never guess among 2+ matches; disambiguation discloses role labels only,
   never identifying details (§1.2''s disclosure fix).';

-- Real, serious gap found and fixed before this migration was committed: 20260101000024's
-- `alter default privileges ... grant execute on functions to anon, authenticated, service_role`
-- (a blanket rule for every *future* function too) meant this function -- which returns which
-- org/entity/tenant/owner owns ANY phone number, completely unscoped by the caller's own identity
-- -- was executable by `anon` (fully unauthenticated, the public API key embedded in every
-- client) the moment it was created. Confirmed live via
-- `select grantee from information_schema.role_routine_grants where routine_name =
-- 'resolve_whatsapp_sender'` before writing this fix, not assumed from reading the earlier
-- migration. This is exactly the class of information-disclosure vector `has_org_role()` avoids
-- by only ever confirming/denying the caller's *own* membership -- resolve_whatsapp_sender()
-- has no equivalent self-check by design (WHATSAPP.md §1.2: "org is what we're trying to find"),
-- so it must be restricted to the one caller who is supposed to invoke it: the service-role
-- webhook handler.
revoke execute on function public.resolve_whatsapp_sender(text) from public, anon, authenticated;
