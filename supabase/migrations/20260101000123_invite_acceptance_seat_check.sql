-- Staff invitation flow audit (this date): closes a real gap found while diagnosing the
-- commercial-onboarding-bypass fix -- accept_organization_invite() never re-validated staff-seat
-- capacity at the moment of acceptance, only at invite-CREATION time (canInviteStaff() in
-- POST /api/v1/organizations/:orgId/invites). Between creation and acceptance an org's effective
-- seat count can change (a plan downgrade, or several invites accepted in quick succession), so an
-- org could end up over its plan's staff limit with nothing server-side stopping it.
--
-- Locks the ORG row itself (public.organizations), not just the invite row -- the pre-existing
-- `for update` on organization_invites only serializes a second acceptance attempt of the SAME
-- invite; it does nothing to stop two DIFFERENT invitations for the SAME org being accepted
-- concurrently, which is exactly the race this fix must close (two acceptances could otherwise
-- both read "1 seat available" before either commits). Locking the org row makes the second
-- concurrent acceptance wait for the first to commit (or roll back), then re-evaluate the count
-- with the first acceptance's effect already visible -- standard "lock the parent to serialize a
-- counted child resource" pattern.
--
-- Reuses org_staff_seat_limit()/org_active_billable_staff_count() unchanged (migration
-- 20260101000094 lineage) -- same seat-limit source, same principal-exclusion,
-- same active-only counting rule already used everywhere else in the app (StaffAccessPanel,
-- canInviteStaff()). No new entitlement concept introduced.
--
-- The check raises BEFORE any insert/update in this function runs, so a rejected acceptance rolls
-- back the whole transaction atomically: no membership row, no property_access row, no
-- accepted_at update, no audit_events row. The invitation remains exactly as pending as it was
-- before the attempt -- safe to retry once a seat frees up.
create or replace function public.accept_organization_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invite public.organization_invites%rowtype;
  v_user_email citext;
  v_seat_limit integer;
  v_current_count integer;
begin
  if auth.uid() is null then
    raise exception 'accept_organization_invite requires an authenticated user';
  end if;

  select email into v_user_email from auth.users where id = auth.uid();

  select * into v_invite
  from public.organization_invites
  where token = p_token
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
    and email = v_user_email
  for update;

  if not found then
    raise exception 'Invite not found, expired, or does not match the signed-in user''s email';
  end if;

  -- Serialize against any other concurrent acceptance for this same org before counting seats.
  perform 1 from public.organizations where id = v_invite.org_id for update;

  v_seat_limit := public.org_staff_seat_limit(v_invite.org_id);
  if v_seat_limit is not null then
    v_current_count := public.org_active_billable_staff_count(v_invite.org_id);
    if v_current_count >= v_seat_limit then
      raise exception 'staff_seat_limit_reached: this organization has no remaining staff seats available.';
    end if;
  end if;

  insert into public.organization_members (
    org_id, user_id, role, status, joined_at, invited_by, property_access_mode
  )
  values (
    v_invite.org_id, auth.uid(), v_invite.role, 'active', now(), v_invite.invited_by,
    v_invite.property_access_mode
  )
  on conflict (org_id, user_id) do update
    set role = excluded.role, status = 'active', joined_at = now(),
        property_access_mode = excluded.property_access_mode;

  if v_invite.property_access_mode = 'selected' then
    insert into public.property_access (property_id, user_id, property_role, granted_by)
    select oip.property_id, auth.uid(), oip.property_role, v_invite.invited_by
    from public.organization_invite_properties oip
    where oip.invite_id = v_invite.id
    on conflict (property_id, user_id) do update
      set property_role = excluded.property_role, updated_at = now();
  end if;

  update public.organization_invites set accepted_at = now() where id = v_invite.id;

  insert into public.audit_events (org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
  values (
    v_invite.org_id, auth.uid(), 'user', 'organization_invite.accepted', 'organization_invites', v_invite.id,
    jsonb_build_object('role', v_invite.role, 'propertyAccessMode', v_invite.property_access_mode)
  );

  return v_invite.org_id;
end;
$function$;
