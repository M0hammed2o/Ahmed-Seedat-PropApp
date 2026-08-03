-- PRODUCT DECISION 2 (2026-08-03): tenant activation via secure invitation. A landlord/staff
-- member creates the tenant/property/unit/lease first (already true today); the tenant then
-- links an authenticated account to that existing record, never re-entering data already
-- captured. Deliberately a SEPARATE table from organization_invites (20260101000018), not a
-- merge: org invites identify a *role grant into an org* for someone who may not exist as a row
-- anywhere yet; tenant invitations link an *already-existing* `tenants` row to an auth identity,
-- carry a short-code delivery path org invites never needed, and require hashed-at-rest storage
-- org invites' plaintext `token uuid` column doesn't (org-invite tokens are single-purpose,
-- expiring, and already narrowly scoped by email match; tenant activation codes are explicitly
-- flagged in the instruction as needing hashed storage + failed-attempt lockout since a short
-- code is materially lower-entropy than a UUID).

create type public.tenant_invitation_delivery_channel as enum ('email', 'whatsapp', 'manual');

create table public.tenant_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- sha256 hex digest of the raw token/code -- the plaintext is returned exactly once, by
  -- create_tenant_invitation() below, to the caller's own response; never stored, never logged.
  token_hash text not null unique,
  short_code_hash text unique,
  delivery_channel public.tenant_invitation_delivery_channel not null,
  -- Masked, not the real address/number ("j***@example.com" / "+27 ** *** **34") -- safe to
  -- display in the staff-facing invitation-status list without re-exposing the destination.
  destination_hint text,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by_user_id uuid references auth.users(id),
  revoked_at timestamptz,
  created_by_user_id uuid not null references auth.users(id),
  failed_attempt_count integer not null default 0,
  resend_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index tenant_invitations_org_idx on public.tenant_invitations (org_id);
create index tenant_invitations_tenant_idx on public.tenant_invitations (tenant_id);
create index tenant_invitations_expires_idx on public.tenant_invitations (expires_at) where accepted_at is null and revoked_at is null;

-- DB-level backstop for "one active invitation per tenant" (create_tenant_invitation() also
-- revokes any prior active one before inserting, same belt-and-braces pattern as
-- lease_templates_one_default_per_org, migration 20260101000056) -- a partial unique index, not a
-- plain unique constraint, since accepted/revoked rows must be allowed to coexist as history.
create unique index tenant_invitations_one_active_per_tenant
  on public.tenant_invitations (tenant_id)
  where accepted_at is null and revoked_at is null;

-- tenant_id.org_id must equal org_id -- guards against a caller passing a mismatched pair
-- directly (defense in depth; create_tenant_invitation() also derives org_id from the tenant
-- row itself rather than trusting a client-supplied value, so this trigger should never actually
-- fire from that path, only from a hypothetical future direct-insert caller).
create or replace function public.check_tenant_invitation_org_match()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.tenants t where t.id = new.tenant_id and t.org_id = new.org_id) then
    raise exception 'tenant_invitations.org_id must match tenant_invitations.tenant_id''s own org_id';
  end if;
  return new;
end;
$$;

create trigger tenant_invitations_org_match_check
  before insert or update on public.tenant_invitations
  for each row execute function public.check_tenant_invitation_org_match();

alter table public.tenant_invitations enable row level security;

-- Staff (agent+, matching PERMISSIONS.md's "Properties/Units/Leases/Tenants: Full" floor for
-- agent) can see and manage invitations for their own org's tenants. The tenant/invitee
-- themselves gets ZERO direct table access, before or after acceptance -- "no personal
-- information disclosure before validation" means acceptance goes exclusively through
-- accept_tenant_invitation() (security definer, validates server-side, never lets an
-- unauthenticated or non-matching caller read a row directly).
create policy "tenant_invitations_select_staff"
  on public.tenant_invitations for select
  using (public.has_org_role(org_id, 'agent'));

create policy "tenant_invitations_insert_staff"
  on public.tenant_invitations for insert
  with check (public.has_org_role(org_id, 'agent'));

create policy "tenant_invitations_update_staff"
  on public.tenant_invitations for update
  using (public.has_org_role(org_id, 'agent'))
  with check (public.has_org_role(org_id, 'agent'));

-- No delete policy -- revoke via update (revoked_at), matching every other table's
-- no-hard-delete-on-business-records rule (PERMISSIONS.md).

-- Generates a token (and optionally a short code), hashes both, revokes any prior active
-- invitation for the same tenant, inserts the new row, and returns the PLAINTEXT token/code --
-- the only time either value ever exists outside this function's local variables. security
-- definer so it can insert regardless of the caller's own RLS visibility into the row it just
-- created (not needed today since staff already pass tenant_invitations_insert_staff, but keeps
-- the generation logic in one trusted place rather than duplicated at every call site).
create or replace function public.create_tenant_invitation(
  p_tenant_id uuid,
  p_delivery_channel public.tenant_invitation_delivery_channel,
  p_include_short_code boolean default false,
  p_destination_hint text default null
)
returns table (invitation_id uuid, token text, short_code text, expires_at timestamptz)
language plpgsql
security definer
-- pgcrypto (gen_random_bytes/digest) lives in the `extensions` schema in this project, not
-- `public` -- confirmed live (`select extnamespace::regnamespace from pg_extension where
-- extname='pgcrypto'`), not assumed; every other SECURITY DEFINER function in this codebase only
-- ever needed gen_random_uuid() (core Postgres since v13, not pgcrypto), so this is the first one
-- that actually needs the extra schema on its search_path.
set search_path = public, extensions
as $$
declare
  v_org_id uuid;
  v_token text;
  v_short_code text;
  v_id uuid;
  v_expires_at timestamptz;
begin
  select org_id into v_org_id from public.tenants where id = p_tenant_id;
  if v_org_id is null then
    raise exception 'Tenant not found';
  end if;

  if not public.has_org_role(v_org_id, 'agent') then
    raise exception 'Only agent-or-above staff can create a tenant invitation';
  end if;

  -- One active invitation per tenant: revoke any prior un-accepted, un-revoked one first (the
  -- partial unique index above backs this at the DB level regardless of this step ever being
  -- skipped by a future code path).
  update public.tenant_invitations
    set revoked_at = now()
    where tenant_id = p_tenant_id and accepted_at is null and revoked_at is null;

  -- 32 random bytes -> 64 hex chars for the link token (256 bits, not brute-forceable). The
  -- short code is a separate, deliberately human-typeable 8-char alphanumeric string excluding
  -- visually ambiguous characters (0/O, 1/I/l) -- low entropy by design (meant to be read off a
  -- screen and typed, not emailed), which is exactly why it's never accepted alone: the RPC
  -- below always cross-checks it against the tenant's on-file email when one exists, and is rate
  -- limited + failed-attempt-locked regardless.
  v_token := encode(gen_random_bytes(32), 'hex');
  v_expires_at := now() + interval '7 days';

  if p_include_short_code then
    v_short_code := (
      select string_agg(substr(chars, (random() * length(chars))::int + 1, 1), '')
      from (select '23456789ABCDEFGHJKMNPQRSTUVWXYZ' as chars) c,
           generate_series(1, 8)
    );
  end if;

  insert into public.tenant_invitations (
    org_id, tenant_id, token_hash, short_code_hash, delivery_channel, destination_hint,
    expires_at, created_by_user_id
  )
  values (
    v_org_id, p_tenant_id,
    encode(digest(v_token, 'sha256'), 'hex'),
    case when v_short_code is not null then encode(digest(v_short_code, 'sha256'), 'hex') else null end,
    p_delivery_channel, p_destination_hint, v_expires_at, auth.uid()
  )
  returning id into v_id;

  return query select v_id, v_token, v_short_code, v_expires_at;
end;
$$;

-- Regenerates: same as create (revokes the prior active invite, issues a fresh token/code) --
-- exposed as a distinct RPC name only for callers that want to express "regenerate" intent
-- explicitly; the underlying operation is identical to create_tenant_invitation() since it
-- already revokes-then-creates.
create or replace function public.regenerate_tenant_invitation(
  p_tenant_id uuid,
  p_delivery_channel public.tenant_invitation_delivery_channel,
  p_include_short_code boolean default false,
  p_destination_hint text default null
)
returns table (invitation_id uuid, token text, short_code text, expires_at timestamptz)
language sql
security definer
-- pgcrypto (gen_random_bytes/digest) lives in the `extensions` schema in this project, not
-- `public` -- confirmed live (`select extnamespace::regnamespace from pg_extension where
-- extname='pgcrypto'`), not assumed; every other SECURITY DEFINER function in this codebase only
-- ever needed gen_random_uuid() (core Postgres since v13, not pgcrypto), so this is the first one
-- that actually needs the extra schema on its search_path.
set search_path = public, extensions
as $$
  select * from public.create_tenant_invitation(p_tenant_id, p_delivery_channel, p_include_short_code, p_destination_hint);
$$;

-- Atomic, idempotent acceptance. Exactly one of p_token/p_short_code is provided by the caller;
-- p_email is required whenever a short code is used (the "combine a short code with another
-- verification factor" requirement) and is cross-checked against the tenant's on-file email
-- whenever the RPC can find a candidate row that way.
--
-- Returns a result ROW rather than raising an exception for every expected/recoverable failure
-- (wrong code, expired, revoked, already used, mismatch, already linked) -- deliberately, found
-- by actually running this against pgTAP's throws_ok, not assumed: a PL/pgSQL function's writes
-- are rolled back to the calling savepoint the instant it raises an exception, INCLUDING writes
-- made earlier in that same invocation (e.g. the failed_attempt_count increment right before the
-- "wrong code" raise). That would make failed-attempt tracking silently never persist in real use
-- too, not just in this test suite -- a genuine bug, not a testing artifact, caught by writing the
-- adversarial test for it rather than assuming the naive raise-per-branch version was correct.
-- `raise exception` is kept only for truly exceptional/programmer-error cases (no auth session,
-- malformed params) that have no side effect worth preserving anyway.
create or replace function public.accept_tenant_invitation(
  p_token text default null,
  p_short_code text default null,
  p_email citext default null
)
returns table (success boolean, error_code text, tenant_id uuid)
language plpgsql
security definer
-- pgcrypto (gen_random_bytes/digest) lives in the `extensions` schema in this project, not
-- `public` -- confirmed live (`select extnamespace::regnamespace from pg_extension where
-- extname='pgcrypto'`), not assumed; every other SECURITY DEFINER function in this codebase only
-- ever needed gen_random_uuid() (core Postgres since v13, not pgcrypto), so this is the first one
-- that actually needs the extra schema on its search_path.
set search_path = public, extensions
as $$
declare
  v_invite public.tenant_invitations%rowtype;
  v_tenant public.tenants%rowtype;
  v_org public.organizations%rowtype;
  v_caller_email citext;
  v_max_failed_attempts constant integer := 5;
begin
  if auth.uid() is null then
    raise exception 'accept_tenant_invitation requires an authenticated user';
  end if;
  if (p_token is null) = (p_short_code is null) then
    raise exception 'Provide exactly one of a token or a short code';
  end if;

  select email into v_caller_email from auth.users where id = auth.uid();

  if p_token is not null then
    select * into v_invite from public.tenant_invitations
      where token_hash = encode(digest(p_token, 'sha256'), 'hex')
      for update;

    if not found then
      return query select false, 'not_found'::text, null::uuid;
      return;
    end if;
  else
    if p_email is null then
      raise exception 'An email address is required alongside a short code';
    end if;
    -- Narrow to candidates whose tenant email matches the supplied email first -- a wrong code
    -- against a wrong email never even identifies a row to lock out, matching org-invite's own
    -- "never trusts a client-supplied identity alone" posture.
    select ti.* into v_invite
      from public.tenant_invitations ti
      join public.tenants t on t.id = ti.tenant_id
      where t.email = p_email
        and ti.short_code_hash is not null
        and ti.accepted_at is null
        and ti.revoked_at is null
      order by ti.created_at desc
      limit 1
      for update;

    if not found then
      return query select false, 'invalid_code'::text, null::uuid;
      return;
    end if;
    if v_invite.failed_attempt_count >= v_max_failed_attempts then
      return query select false, 'locked_out'::text, null::uuid;
      return;
    end if;
    if v_invite.short_code_hash <> encode(digest(p_short_code, 'sha256'), 'hex') then
      update public.tenant_invitations set failed_attempt_count = failed_attempt_count + 1 where id = v_invite.id;
      return query select false, 'invalid_code'::text, null::uuid;
      return;
    end if;
  end if;

  if v_invite.revoked_at is not null then
    return query select false, 'revoked'::text, null::uuid;
    return;
  end if;
  if v_invite.expires_at <= now() then
    return query select false, 'expired'::text, null::uuid;
    return;
  end if;
  -- Idempotent retry: the same authenticated user re-submitting an already-accepted invitation
  -- (e.g. a double-click, or returning to the link after OAuth redirected them here twice) is a
  -- no-op success, not an error.
  if v_invite.accepted_at is not null then
    if v_invite.accepted_by_user_id = auth.uid() then
      return query select true, null::text, v_invite.tenant_id;
      return;
    end if;
    return query select false, 'already_used'::text, null::uuid;
    return;
  end if;

  select * into v_tenant from public.tenants where id = v_invite.tenant_id;
  select * into v_org from public.organizations where id = v_invite.org_id;

  if v_org.status = 'archived' then
    return query select false, 'org_inactive'::text, null::uuid;
    return;
  end if;
  if v_tenant.org_id <> v_invite.org_id then
    raise exception 'Invitation data is inconsistent.'; -- structurally unreachable (trigger-enforced), kept as a defensive check
  end if;
  if v_tenant.user_id is not null and v_tenant.user_id <> auth.uid() then
    return query select false, 'already_linked'::text, null::uuid;
    return;
  end if;
  if v_tenant.email is not null and v_caller_email is not null and v_tenant.email <> v_caller_email then
    return query select false, 'email_mismatch'::text, null::uuid;
    return;
  end if;

  update public.tenants set user_id = auth.uid() where id = v_invite.tenant_id;
  update public.tenant_invitations set accepted_at = now(), accepted_by_user_id = auth.uid() where id = v_invite.id;

  -- Audit write is part of the same atomic operation, not a separate best-effort call from the
  -- API layer (unlike writeAuditEvent()'s lib/audit.ts convention elsewhere) -- the instruction
  -- requires acceptance to be a single atomic unit including "write an audit event"; doing it
  -- here means a failure can never leave a linked tenant with no audit trail.
  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
  values (
    v_invite.org_id, auth.uid(), 'user', 'tenant_invitation.accepted', 'tenant_invitations', v_invite.id,
    jsonb_build_object('tenantId', v_invite.tenant_id, 'deliveryChannel', v_invite.delivery_channel)
  );

  return query select true, null::text, v_invite.tenant_id;
end;
$$;

comment on function public.accept_tenant_invitation(text, text, citext) is
  'Atomic, idempotent tenant-invitation acceptance (PRODUCT DECISION 2, 2026-08-03). Links
   tenants.user_id to the authenticated caller. Returns (success, error_code, tenant_id) rather
   than raising for expected failures -- raising would roll back the failed_attempt_count
   increment recorded in the same call (verified live, not assumed). Never discloses tenant PII
   for a failed/unmatched attempt -- every error_code is generic. Short-code attempts are looked
   up by (tenant email, code) together, never by code alone, and are failed-attempt-locked after
   5 tries. error_code values: not_found, invalid_code, locked_out, revoked, expired,
   already_used, org_inactive, already_linked, email_mismatch.';
