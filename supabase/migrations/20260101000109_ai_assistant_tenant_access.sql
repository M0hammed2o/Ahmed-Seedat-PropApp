-- Final pre-UAT engineering pass (WORKLOG.md this date), Part 6-14: extends the AI Assistant to
-- tenant-portal users. ai_conversations_all_own (20260101000042) originally required
-- has_org_role(org_id, 'viewer') -- correct for an org-staff member, but a pure tenant (no
-- organization_members row at all) fails that check unconditionally, so a tenant could never
-- create or use a conversation row. Additive: widens the SAME policy to also accept a caller who
-- has an active tenancy in that org (public.tenants.user_id = auth.uid()), mirroring the
-- tenant-self predicate shape payment_reports_select_tenant_self (20260101000106) already
-- established, rather than inventing a new one. ai_messages' own policy needs no change -- it
-- only ever checks the parent conversation's user_id, which already covers both caller types.

drop policy "ai_conversations_all_own" on public.ai_conversations;

create policy "ai_conversations_all_own"
  on public.ai_conversations for all
  using (
    user_id = auth.uid()
    and (
      public.has_org_role(org_id, 'viewer')
      or exists (
        select 1 from public.tenants t where t.org_id = ai_conversations.org_id and t.user_id = auth.uid()
      )
    )
  )
  with check (
    user_id = auth.uid()
    and (
      public.has_org_role(org_id, 'viewer')
      or exists (
        select 1 from public.tenants t where t.org_id = ai_conversations.org_id and t.user_id = auth.uid()
      )
    )
  );
