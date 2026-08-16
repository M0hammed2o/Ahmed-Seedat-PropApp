-- WhatsApp V1 completion pass (WORKLOG.md this date), pre-Meta-template-approval infrastructure.
-- Three independent, additive feature areas bundled in one migration because all three are
-- schema prerequisites for code in the same pass: (1) payment_reports -- a tenant/staff payment
-- CLAIM layer sitting above the existing, UNCHANGED accounting primitives
-- (cash_receipts/bank_transactions/confirm_bank_transaction_match), never itself posting to the
-- ledger or flipping rent_schedules.status -- "reported" is not "confirmed," and this table's own
-- confirm/reject RPCs only ever touch this table; (2) phone_verification_challenges -- the OTP
-- backend for populating verified_phone_numbers, delivered over email (already real/working) with
-- WhatsApp left as an explicitly-pending future delivery adapter (an Authentication-category Meta
-- template, distinct from the 8 Utility templates currently in review, would be needed for that);
-- (3) marker columns on rent_schedules/leases for the rent-reminder/overdue/lease-expiry jobs,
-- mirroring compliance_requirements' own due_reminder_sent_at/overdue_reminder_sent_at pattern
-- (20260101000099) exactly.
--
-- Nothing here sends anything -- these are backend/data primitives only. No WhatsApp template is
-- sent by any function in this file.

-- ============================================================
-- 1. payment_reports
-- ============================================================

create type public.payment_report_status as enum ('reported', 'confirmed', 'rejected');
create type public.payment_report_method as enum ('eft', 'cash', 'other');

create table public.payment_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  lease_id uuid not null references public.leases(id) on delete cascade,
  rent_schedule_id uuid references public.rent_schedules(id),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Who actually submitted this report -- a tenant self-reporting an EFT payment, or a staff
  -- member reporting a cash payment on the tenant's behalf (Phase A's "OR an authorised staff
  -- member records a cash payment" case). Never both/neither.
  reported_by_tenant boolean not null,
  reported_by_user_id uuid not null references auth.users(id),
  amount numeric(12, 2) not null check (amount > 0),
  payment_method public.payment_report_method not null,
  payment_date date not null,
  -- Proof of payment -- an existing `documents` row (reused, not duplicated storage/validation
  -- logic). Nullable: cash reports don't always have a photographed receipt on hand at report
  -- time (matches cash_receipts.document_id's own nullable "optional... based on existing rules"
  -- posture, migration 20260101000073).
  document_id uuid references public.documents(id),
  status public.payment_report_status not null default 'reported',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'rejected' or rejection_reason is null),
  check ((status in ('confirmed', 'rejected')) = (reviewed_by is not null and reviewed_at is not null))
);

create index payment_reports_org_status_idx on public.payment_reports (org_id, status);
create index payment_reports_property_idx on public.payment_reports (property_id);
create index payment_reports_lease_idx on public.payment_reports (lease_id);
create index payment_reports_tenant_idx on public.payment_reports (tenant_id);

create trigger set_payment_reports_updated_at
  before update on public.payment_reports
  for each row execute function public.set_updated_at();

alter table public.payment_reports enable row level security;

-- Same staff-or-owner read shape as cash_receipts (migration 20260101000073) plus tenant-self,
-- reusing tenant_portal_rls.sql's caller_tenant_ids() helper (20260101000049) rather than
-- inventing a second tenant-self predicate.
create policy "payment_reports_select_tenant_self"
  on public.payment_reports for select
  using (tenant_id in (select public.caller_tenant_ids()));

create policy "payment_reports_select_staff_or_owner"
  on public.payment_reports for select
  using (
    (public.has_org_role(org_id, 'viewer') and public.has_property_access(property_id, 'read_only'))
    or public.has_property_access(property_id, 'owner')
  );

-- Tenant self-insert: mirrors maintenance_tickets_insert_tenant_self's exact predicate shape
-- (20260101000049) -- caller must be reporting for their OWN tenant_id/lease, never another
-- tenant's, and reported_by_tenant/reported_by_user_id must honestly reflect the caller.
create policy "payment_reports_insert_tenant_self"
  on public.payment_reports for insert
  with check (
    reported_by_tenant = true
    and reported_by_user_id = auth.uid()
    and tenant_id in (select public.caller_tenant_ids())
    and public.caller_is_tenant_of_lease(lease_id)
  );

-- Staff insert (Phase A's "staff records a cash payment" case): agent+ org role and property
-- access, same floor cash_receipts_insert_agent_plus_and_property_access already requires.
create policy "payment_reports_insert_staff"
  on public.payment_reports for insert
  with check (
    reported_by_tenant = false
    and reported_by_user_id = auth.uid()
    and public.has_org_role(org_id, 'agent')
    and (public.has_property_access(property_id, 'property_manager') or public.has_property_access(property_id, 'owner'))
  );

-- Update (confirm/reject) is RPC-only (confirm_payment_report/reject_payment_report below, both
-- SECURITY INVOKER, same reasoning cash_receipts' own confirm RPC documents) -- this policy is
-- what makes their internal UPDATE succeed under RLS, matching accountant+ (the same role that
-- actually confirms a cash deposit) rather than a new, invented "owner approval" role.
create policy "payment_reports_update_accountant_plus"
  on public.payment_reports for update
  using (public.has_org_role(org_id, 'accountant'))
  with check (public.has_org_role(org_id, 'accountant'));

-- confirm_payment_report(): acknowledgement only -- deliberately does NOT touch rent_schedules,
-- cash_receipts, or the ledger. "Reported" payments already have a real, separate, UNCHANGED
-- confirmation mechanism for the money itself (confirm_cash_receipt_deposit()/
-- confirm_bank_transaction_match()) -- this RPC's only job is flipping THIS table's own
-- acknowledgement state, so a caller (the API route) knows it may now dispatch
-- payment_received_confirmation to the tenant. Never auto-posts anything, per this pass's own
-- explicit instruction not to alter confirmed financial balances or double-count against bank
-- reconciliation.
create or replace function public.confirm_payment_report(p_payment_report_id uuid)
returns table (success boolean, error_code text, org_id uuid, tenant_id uuid, amount numeric)
language plpgsql
as $$
declare
  v_report public.payment_reports%rowtype;
begin
  if auth.uid() is null then
    raise exception 'confirm_payment_report requires an authenticated user';
  end if;

  select * into v_report from public.payment_reports where id = p_payment_report_id for update;
  if not found then
    return query select false, 'not_found'::text, null::uuid, null::uuid, null::numeric;
    return;
  end if;

  if not public.has_org_role(v_report.org_id, 'accountant') then
    return query select false, 'forbidden'::text, null::uuid, null::uuid, null::numeric;
    return;
  end if;

  if v_report.status <> 'reported' then
    -- Idempotent: re-confirming an already-confirmed report is a no-op success (matches
    -- cancelOrgSubscription()'s own "already done" convention), never a duplicate transition;
    -- confirming an already-REJECTED report is a real conflict, not a no-op.
    if v_report.status = 'confirmed' then
      return query select true, null::text, v_report.org_id, v_report.tenant_id, v_report.amount;
      return;
    end if;
    return query select false, 'already_rejected'::text, null::uuid, null::uuid, null::numeric;
    return;
  end if;

  update public.payment_reports
  set status = 'confirmed', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_payment_report_id;

  -- No audit_events write here, deliberately -- this function is SECURITY INVOKER (the calling
  -- accountant's own real privileges authorize the UPDATE above, same posture
  -- confirm_cash_receipt_deposit() takes), and audit_events has no client insert policy at all
  -- (service-role only). Same convention cash_receipts' own confirm RPC follows: audit logging
  -- happens at the application layer (writeAuditEvent() with the service-role client) after this
  -- RPC returns success, not inside a SECURITY INVOKER function that cannot write there under RLS.
  return query select true, null::text, v_report.org_id, v_report.tenant_id, v_report.amount;
end;
$$;

comment on function public.confirm_payment_report(uuid) is
  'Owner/staff (accountant+) acknowledges a reported payment. Does NOT touch the ledger or
   rent_schedules -- see this migration''s own header comment. Idempotent on an already-confirmed
   report; returns already_rejected if the report was already rejected (a real state conflict, not
   a no-op). Caller (the API route) writes the audit_events row and dispatches
   payment_received_confirmation to the tenant only after this returns success=true.';

create or replace function public.reject_payment_report(p_payment_report_id uuid, p_reason text)
returns table (success boolean, error_code text)
language plpgsql
as $$
declare
  v_report public.payment_reports%rowtype;
begin
  if auth.uid() is null then
    raise exception 'reject_payment_report requires an authenticated user';
  end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'A rejection reason is required';
  end if;

  select * into v_report from public.payment_reports where id = p_payment_report_id for update;
  if not found then
    return query select false, 'not_found'::text;
    return;
  end if;

  if not public.has_org_role(v_report.org_id, 'accountant') then
    return query select false, 'forbidden'::text;
    return;
  end if;

  if v_report.status <> 'reported' then
    if v_report.status = 'rejected' then
      return query select true, null::text; -- idempotent
      return;
    end if;
    return query select false, 'already_confirmed'::text;
    return;
  end if;

  update public.payment_reports
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = p_reason
  where id = p_payment_report_id;

  -- Same "no audit_events write here" reasoning as confirm_payment_report() above.
  return query select true, null::text;
end;
$$;

comment on function public.reject_payment_report(uuid, text) is
  'Owner/staff (accountant+) rejects a reported payment (e.g. proof does not match, duplicate
   report). Idempotent on an already-rejected report; returns already_confirmed if the report was
   already confirmed. No ledger effect -- this table never posted to the ledger in the first
   place. Caller (the API route) writes the audit_events row after this returns success=true.';

-- ============================================================
-- 2. Phone verification (OTP) -- populates verified_phone_numbers
-- ============================================================

-- Staff (organization_members) genuinely has no phone column anywhere in the schema today --
-- confirmed by reading 20260101000018 before writing this. Additive, nullable: this is a
-- prerequisite for staff phone verification to mean anything (there is nothing to verify without
-- a number on file first), not itself a UI/profile-editing change.
alter table public.organization_members add column phone text;

create table public.phone_verification_challenges (
  id uuid primary key default gen_random_uuid(),
  entity_type public.verified_phone_entity_type not null,
  entity_id uuid not null,
  phone_number_e164 text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  attempts_used integer not null default 0,
  max_attempts integer not null default 5,
  verified_at timestamptz,
  requested_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index phone_verification_challenges_entity_idx
  on public.phone_verification_challenges (entity_type, entity_id, created_at desc);

alter table public.phone_verification_challenges enable row level security;
-- Zero client policies, deliberately -- same privileged-table pattern as verified_phone_numbers
-- itself (20260101000040): a caller never reads another party's OTP hash or attempt count
-- directly, only through the SECURITY DEFINER RPCs below, which return just enough (success/
-- error_code) to drive a UI.

-- request_phone_verification(): generates a 6-digit OTP, hashes it (same digest()/sha256 pattern
-- tenant_invitations' own token hashing already established, 20260101000059 -- never a new
-- hashing convention), rate-limited via the existing check_rate_limit() RPC (20260101000058).
-- Returns the PLAINTEXT code -- but ONLY to this immediate, already-authenticated, verified-owner
-- caller; Postgres cannot itself send an email/WhatsApp message, so the calling application layer
-- is what actually delivers it (lib/phoneVerification.ts, email today, WhatsApp explicitly
-- deferred -- see this migration's header comment).
create or replace function public.request_phone_verification(
  p_entity_type public.verified_phone_entity_type,
  p_entity_id uuid,
  p_phone_number_e164 text
)
returns table (challenge_id uuid, otp_code text, expires_at timestamptz, error_code text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owns boolean := false;
  v_code text;
  v_challenge_id uuid;
  v_expires_at timestamptz;
  v_allowed boolean;
begin
  if auth.uid() is null then
    raise exception 'request_phone_verification requires an authenticated user';
  end if;
  if p_phone_number_e164 !~ '^\+[1-9]\d{6,14}$' then
    return query select null::uuid, null::text, null::timestamptz, 'invalid_phone'::text;
    return;
  end if;

  -- Ownership: the caller must BE the entity requesting its own phone verified -- never
  -- verifiable on someone else's behalf, matching link_owner_to_self()'s own "explicit, never
  -- inferred" posture.
  if p_entity_type = 'tenant' then
    v_owns := p_entity_id in (select public.caller_tenant_ids());
  elsif p_entity_type = 'owner' then
    v_owns := exists (select 1 from public.owners where id = p_entity_id and user_id = auth.uid());
  elsif p_entity_type = 'organization_member' then
    v_owns := exists (
      select 1 from public.organization_members
      where id = p_entity_id and user_id = auth.uid() and status = 'active'
    );
  end if;
  if not v_owns then
    return query select null::uuid, null::text, null::timestamptz, 'forbidden'::text;
    return;
  end if;

  select public.check_rate_limit(
    'phone-verify-request:' || auth.uid()::text, 5, 3600
  ) into v_allowed;
  if not v_allowed then
    return query select null::uuid, null::text, null::timestamptz, 'rate_limited'::text;
    return;
  end if;

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');
  v_expires_at := now() + interval '10 minutes';

  insert into public.phone_verification_challenges
    (entity_type, entity_id, phone_number_e164, otp_hash, expires_at, requested_by_user_id)
  values (
    p_entity_type, p_entity_id, p_phone_number_e164,
    encode(digest(v_code, 'sha256'), 'hex'), v_expires_at, auth.uid()
  )
  returning id into v_challenge_id;

  return query select v_challenge_id, v_code, v_expires_at, null::text;
end;
$$;

comment on function public.request_phone_verification(public.verified_phone_entity_type, uuid, text) is
  'Phase F, WhatsApp V1 completion pass. Issues a 10-minute, 6-digit OTP challenge for the caller''s
   OWN tenant/owner/organization_member record -- never on behalf of another identity. Rate-limited
   to 5 requests/hour per caller via the existing check_rate_limit() infrastructure. Returns the
   plaintext code to the immediate (already-authenticated) caller only, for the application layer
   to actually deliver (email today; WhatsApp requires an Authentication-category Meta template
   not yet created/approved, deliberately left as a pending delivery adapter, not built here).';

revoke execute on function public.request_phone_verification(public.verified_phone_entity_type, uuid, text) from public, anon;

-- confirm_phone_verification(): checks the code, enforces the attempt limit (incremented on every
-- attempt, including a wrong one -- so brute-forcing a 6-digit code against a 5-attempt budget is
-- infeasible), and on success upserts verified_phone_numbers. Deliberately allows the SAME phone
-- to verify for more than one distinct entity (WHATSAPP.md §1.2's own documented, accepted
-- AMBIGUOUS case -- "the same person can legitimately be both an owner and a tenant") -- this is
-- not a bug to guard against, it's the resolution algorithm's designed behaviour.
create or replace function public.confirm_phone_verification(p_challenge_id uuid, p_otp_code text)
returns table (success boolean, error_code text, attempts_remaining integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_challenge public.phone_verification_challenges%rowtype;
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'confirm_phone_verification requires an authenticated user';
  end if;

  select * into v_challenge from public.phone_verification_challenges where id = p_challenge_id for update;
  if not found then
    return query select false, 'not_found'::text, null::integer;
    return;
  end if;
  if v_challenge.requested_by_user_id <> auth.uid() then
    return query select false, 'forbidden'::text, null::integer;
    return;
  end if;
  if v_challenge.verified_at is not null then
    return query select true, null::text, null::integer; -- idempotent re-confirm
    return;
  end if;
  if v_challenge.expires_at < now() then
    return query select false, 'expired'::text, null::integer;
    return;
  end if;
  if v_challenge.attempts_used >= v_challenge.max_attempts then
    return query select false, 'too_many_attempts'::text, 0;
    return;
  end if;

  update public.phone_verification_challenges
  set attempts_used = attempts_used + 1
  where id = p_challenge_id;

  if encode(digest(p_otp_code, 'sha256'), 'hex') <> v_challenge.otp_hash then
    insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
    values (null, auth.uid(), 'user', 'phone_verification.incorrect_code', 'phone_verification_challenges', p_challenge_id, null);
    return query select false, 'incorrect_code'::text, greatest(v_challenge.max_attempts - v_challenge.attempts_used - 1, 0);
    return;
  end if;

  -- Resolve org_id per entity type -- verified_phone_numbers requires one (it's what
  -- resolve_whatsapp_sender() ultimately returns to route a conversation).
  if v_challenge.entity_type = 'tenant' then
    select org_id into v_org_id from public.tenants where id = v_challenge.entity_id;
  elsif v_challenge.entity_type = 'owner' then
    select org_id into v_org_id from public.owners where id = v_challenge.entity_id;
  elsif v_challenge.entity_type = 'organization_member' then
    select org_id into v_org_id from public.organization_members where id = v_challenge.entity_id;
  end if;
  if v_org_id is null then
    return query select false, 'entity_not_found'::text, null::integer;
    return;
  end if;

  update public.phone_verification_challenges set verified_at = now() where id = p_challenge_id;

  insert into public.verified_phone_numbers (org_id, entity_type, entity_id, phone_number_e164)
  values (v_org_id, v_challenge.entity_type, v_challenge.entity_id, v_challenge.phone_number_e164)
  on conflict (entity_type, entity_id, phone_number_e164) do update set verified_at = now();

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
  values (
    v_org_id, auth.uid(), 'user', 'phone_verification.verified', 'verified_phone_numbers', v_challenge.entity_id,
    jsonb_build_object('entityType', v_challenge.entity_type)
  );

  return query select true, null::text, null::integer;
end;
$$;

comment on function public.confirm_phone_verification(uuid, text) is
  'Phase F. Verifies the OTP, incrementing attempts_used on every call (including wrong guesses) --
   a 6-digit code has only 5 attempts before this challenge is permanently spent, matching
   request_phone_verification()''s own rate-limited-request budget. On success, upserts
   verified_phone_numbers (deliberately allows the same phone to verify for more than one entity --
   WHATSAPP.md §1.2''s own accepted AMBIGUOUS case, not a duplicate-prevention bug).';

revoke execute on function public.confirm_phone_verification(uuid, text) from public, anon;

-- revoke_verified_phone_number(): Phase F's "changing phone number/revoking old number"
-- requirement. Caller must own the entity (same ownership check as request_phone_verification);
-- a plain delete, no re-verification required to revoke (revoking is strictly narrowing access,
-- unlike verifying).
create or replace function public.revoke_verified_phone_number(
  p_entity_type public.verified_phone_entity_type,
  p_entity_id uuid,
  p_phone_number_e164 text
)
returns table (success boolean, error_code text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owns boolean := false;
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'revoke_verified_phone_number requires an authenticated user';
  end if;

  if p_entity_type = 'tenant' then
    v_owns := p_entity_id in (select public.caller_tenant_ids());
  elsif p_entity_type = 'owner' then
    v_owns := exists (select 1 from public.owners where id = p_entity_id and user_id = auth.uid());
  elsif p_entity_type = 'organization_member' then
    v_owns := exists (
      select 1 from public.organization_members
      where id = p_entity_id and user_id = auth.uid() and status = 'active'
    );
  end if;
  if not v_owns then
    return query select false, 'forbidden'::text;
    return;
  end if;

  select org_id into v_org_id from public.verified_phone_numbers
  where entity_type = p_entity_type and entity_id = p_entity_id and phone_number_e164 = p_phone_number_e164;

  delete from public.verified_phone_numbers
  where entity_type = p_entity_type and entity_id = p_entity_id and phone_number_e164 = p_phone_number_e164;

  if v_org_id is not null then
    insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
    values (v_org_id, auth.uid(), 'user', 'phone_verification.revoked', 'verified_phone_numbers', p_entity_id, null);
  end if;

  return query select true, null::text;
end;
$$;

comment on function public.revoke_verified_phone_number(public.verified_phone_entity_type, uuid, text) is
  'Phase F. Lets a caller revoke their OWN verified phone number (e.g. before re-verifying a new
   one) -- ownership-gated the same way request_phone_verification() is. A no-op success if the
   row was already gone (idempotent).';

revoke execute on function public.revoke_verified_phone_number(public.verified_phone_entity_type, uuid, text) from public, anon;

-- ============================================================
-- 3. Reminder marker columns (Phase E) -- mirrors compliance_requirements'
--    due_reminder_sent_at/overdue_reminder_sent_at pattern (20260101000099) exactly.
-- ============================================================

alter table public.rent_schedules
  add column rent_reminder_sent_at timestamptz,
  add column overdue_notice_sent_at timestamptz;

alter table public.leases
  add column expiry_reminder_sent_at timestamptz;

-- rent_schedules_due_soon(): schedules due within p_within_days, not yet reminded, and NOT merely
-- awaiting a payment_reports confirmation -- Phase E's own explicit instruction ("do not send if a
-- payment is merely awaiting confirmation in a way that would make the notice misleading") applies
-- to the overdue variant below, but a due-soon reminder for a schedule with a pending report is
-- also misleading (the tenant already told us they paid), so both sweeps share this exclusion.
create or replace function public.rent_schedules_due_soon(p_within_days integer)
returns table (id uuid, org_id uuid, lease_id uuid, due_date date, amount numeric)
language sql
security definer
set search_path = public
stable
as $$
  select rs.id, rs.org_id, rs.lease_id, rs.due_date, rs.amount
  from public.rent_schedules rs
  where rs.status in ('pending', 'invoiced')
    and rs.due_date between current_date and current_date + p_within_days
    and rs.rent_reminder_sent_at is null
    and not exists (
      select 1 from public.payment_reports pr
      where pr.rent_schedule_id = rs.id and pr.status = 'reported'
    );
$$;

comment on function public.rent_schedules_due_soon(integer) is
  'Phase E. Rent due within N days, not yet reminded, and with no payment_reports row currently
   awaiting confirmation against it (a reminder would be misleading if the tenant already told us
   they paid).';

create or replace function public.rent_schedules_overdue_unreminded()
returns table (id uuid, org_id uuid, lease_id uuid, due_date date, amount numeric)
language sql
security definer
set search_path = public
stable
as $$
  select rs.id, rs.org_id, rs.lease_id, rs.due_date, rs.amount
  from public.rent_schedules rs
  where rs.status = 'overdue'
    and rs.overdue_notice_sent_at is null
    and not exists (
      select 1 from public.payment_reports pr
      where pr.rent_schedule_id = rs.id and pr.status = 'reported'
    );
$$;

comment on function public.rent_schedules_overdue_unreminded() is
  'Phase E. Overdue rent, not yet notice-sent, and with no payment_reports row currently awaiting
   confirmation against it -- Phase E''s explicit instruction: never send an overdue notice while a
   reported payment might already cover it.';

create or replace function public.leases_expiring_unreminded(p_within_days integer)
returns table (id uuid, org_id uuid, unit_id uuid, end_date date)
language sql
security definer
set search_path = public
stable
as $$
  select l.id, l.org_id, l.unit_id, l.end_date
  from public.leases l
  where l.status = 'active'
    and l.end_date is not null
    and l.end_date between current_date and current_date + p_within_days
    and l.expiry_reminder_sent_at is null;
$$;

comment on function public.leases_expiring_unreminded(integer) is
  'Phase E. Active leases ending within N days, not yet reminded. Mirrors
   compliance_requirements_due_soon()''s exact shape (20260101000099).';
