-- Tenant onboarding completion pass (WORKLOG.md this date), Phase 2: safe pre-acceptance
-- activation context. The audit found /activate deliberately shows zero context about which
-- tenancy/landlord an invitation is for (PRODUCT DECISION 2's own "never renders any property/
-- unit/lease/tenant/payment data" -- a considered choice, not an oversight, but short of what a
-- recipient needs to trust the link before clicking it).
--
-- This function is the SAFEST minimal mechanism found: SECURITY DEFINER, callable by an
-- unauthenticated caller (a fresh invitation link is opened signed-out by definition), gated
-- entirely by possession of the token itself (a 256-bit value, already the sole secret this whole
-- flow trusts -- see create_tenant_invitation()). It discloses two tiers, chosen by auth.uid():
--   - Unauthenticated: org name + expiry only. No property/unit/tenant name -- an attacker who
--     merely GUESSES at a token (astronomically unlikely, but the RPC costs nothing to defend
--     anyway) learns nothing about a real address or who lives there.
--   - Authenticated (any signed-in user, not just the tenant themselves -- this is informational,
--     not a grant; accept_tenant_invitation() remains the only path that actually links an
--     account, and it independently re-checks email/lock-out/expiry/revocation): adds
--     property/unit label, matching the audit's own explicit "show full context immediately after
--     authentication before acceptance" instruction.
-- Never returns: rent/balance, payment history, ID number, lease financial terms, private
-- documents, other tenants, ownership %, or any internal-only organization field -- only enough to
-- label a tenancy the same way TenancySummary already does for the switcher UI.
create or replace function public.get_tenant_invitation_context(p_token text)
returns table (
  valid boolean,
  org_name text,
  expires_at timestamptz,
  property_label text,
  unit_label text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invite public.tenant_invitations%rowtype;
  v_org_name text;
  v_property_label text;
  v_unit_label text;
begin
  select * into v_invite from public.tenant_invitations
    where token_hash = encode(digest(p_token, 'sha256'), 'hex');

  if not found
    or v_invite.revoked_at is not null
    or v_invite.accepted_at is not null
    or v_invite.expires_at <= now()
  then
    return query select false, null::text, null::timestamptz, null::text, null::text;
    return;
  end if;

  select coalesce(o.trading_name, o.legal_name) into v_org_name
    from public.organizations o
    where o.id = v_invite.org_id;

  -- Property/unit only once authenticated -- matches the audit's explicit "safest architecture"
  -- instruction rather than exposing an address to anyone who merely holds the link.
  if auth.uid() is not null then
    select p.nickname, u.unit_label
      into v_property_label, v_unit_label
      from public.lease_tenants lt
      join public.leases l on l.id = lt.lease_id
      join public.units u on u.id = l.unit_id
      join public.properties p on p.id = u.property_id
      where lt.tenant_id = v_invite.tenant_id
      order by (l.status = 'active') desc, l.start_date desc
      limit 1;
  end if;

  return query select true, v_org_name, v_invite.expires_at, v_property_label, v_unit_label;
end;
$$;

comment on function public.get_tenant_invitation_context(text) is
  'Safe, minimal pre-acceptance preview for /activate (tenant onboarding completion pass). Gated
   solely by possession of the token; never discloses rent/payment/ID/document/other-tenant data.
   Property/unit are only populated once auth.uid() is not null.';

-- Callable by both anon (pre-auth preview) and authenticated (post-auth preview) -- this function
-- IS the authorization boundary (token possession), not table-level RLS, same posture as
-- create_tenant_invitation()/accept_tenant_invitation() already take.
revoke all on function public.get_tenant_invitation_context(text) from public;
grant execute on function public.get_tenant_invitation_context(text) to anon, authenticated;
