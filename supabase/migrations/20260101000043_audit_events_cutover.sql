-- TECHNICAL_DEBT_REGISTER.md TD-14 paydown: audit_events cutover to DATABASE.md §10's target
-- shape, needed now because AI_ARCHITECTURE.md §5 requires an `ai_assisted` actor_type plus
-- ai_conversation_id/ai_message_id pointers, neither of which the live schema (customer|admin|
-- system actor_type, target_type/target_id, owner_user_id) can represent. Confirmed zero real
-- writers exist yet (grepped apps/admin, apps/mobile, packages/* -- no `.from('audit_events')`
-- call site anywhere in TS today; both documented call sites, reopen_accounting_period() and
-- POST /api/v1/organizations, deliberately abstain from writing pending exactly this migration),
-- so this is a pure schema change with no data-migration risk -- unlike TD-01/TD-02's
-- expand/contract dance, which had to account for real rows. Wiring the two deferred call sites
-- back up is left as separate, explicit follow-on work, to keep this migration a schema change
-- only, not also a re-open-and-re-verify pass over M5/M14's already-shipped route code.

create type public.audit_actor_type as enum ('user', 'system', 'api', 'ai_assisted');

alter table public.audit_events add column actor_type_new public.audit_actor_type;
update public.audit_events set actor_type_new = 'system'; -- no real rows exist; safe default for the (zero) legacy rows
alter table public.audit_events alter column actor_type_new set not null;
alter table public.audit_events drop column actor_type;
alter table public.audit_events rename column actor_type_new to actor_type;
drop type public.actor_type;

alter table public.audit_events rename column target_type to entity_type;
alter table public.audit_events rename column target_id to entity_id;

drop policy "audit_events_select_own" on public.audit_events;
drop index if exists public.audit_events_owner_idx;
drop index if exists public.audit_events_target_idx;
alter table public.audit_events drop column owner_user_id;
alter table public.audit_events drop column metadata; -- not in DATABASE.md §10's target shape; never had a real writer

alter table public.audit_events add column before jsonb;
alter table public.audit_events add column after jsonb;
alter table public.audit_events add column ip_address inet;
-- Deliberately no ON DELETE action on these two -- audit_events' immutability trigger
-- (20260101000036) unconditionally rejects UPDATE, so an ON DELETE SET NULL cascading from a
-- deleted ai_conversation/ai_message would itself be an UPDATE and would fail inside the trigger.
-- Default (RESTRICT-like) behaviour instead blocks the parent DELETE outright, which is the
-- correct semantics anyway: nothing that already fed a permanent audit trail should be
-- deletable out from under it.
alter table public.audit_events add column ai_conversation_id uuid references public.ai_conversations(id);
alter table public.audit_events add column ai_message_id uuid references public.ai_messages(id);

create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);
