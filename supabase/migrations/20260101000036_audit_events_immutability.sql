-- Applies the same real-immutability fix as 20260101000035 (journal_entries/journal_lines) to
-- audit_events, which was documented with the identical, identically-insufficient pattern:
-- "Insert-only. No update/delete policy exists anywhere in this migration set for this table --
-- not even for the owning customer -- so it can serve as a trustworthy audit trail"
-- (20260101000013's own header comment). "No RLS policy" does not restrict `service_role`, which
-- has BYPASSRLS=true -- an audit trail that can be silently rewritten by a compromised or buggy
-- service-role code path is not trustworthy. Unlike journal_entries, audit_events has no
-- schema-anticipated post-insert mutation at all (no reversal-linkage-style field) -- every
-- update and delete is blocked, unconditionally, matching journal_lines' treatment.
create or replace function public.prevent_audit_events_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events rows are permanently immutable once written (trustworthy audit trail requirement)';
end;
$$;

create trigger audit_events_immutable
  before update or delete on public.audit_events
  for each row execute function public.prevent_audit_events_mutation();
