-- Commercial-launch execution plan, Stage 1 cutover, table 6 of 8 (WORKLOG.md this date):
-- `journal_entries` + `journal_lines`. A genuinely different shape from every table cut over so
-- far: `journal_entries` itself has NO property_id at all (an entry can span multiple lines
-- touching different properties, e.g. an owner-payout entry debits owner equity and credits the
-- business bank account, neither property-specific) -- so `journal_entries` is deliberately left
-- UNCHANGED, still org-scoped only. The correct level to gate is `journal_lines.property_id`,
-- which is nullable (not every line is property-specific) -- the fix is conditional: a line with
-- no property_id stays visible to any org viewer exactly as today; a line WITH a property_id now
-- additionally requires has_property_access() on it.
--
-- No RETURNING/bootstrapping concern here at all, unlike properties: journal_lines has no
-- meaningful client-facing INSERT path in the first place -- `journal_lines_insert_accountant_plus`
-- exists only as a defense-in-depth backstop; the one sanctioned write path is
-- post_journal_entry() (this same migration file, 20260101000035), a security-definer function
-- whose internal inserts run as the table owner and bypass RLS entirely, same reasoning as
-- create_property(). Updated for consistency, not because the real flow depends on it.
drop policy if exists "journal_lines_select_org_member" on public.journal_lines;
drop policy if exists "journal_lines_insert_accountant_plus" on public.journal_lines;

create policy "journal_lines_select_org_member_and_property_access"
  on public.journal_lines for select
  using (
    exists (
      select 1 from public.journal_entries e
      where e.id = journal_lines.journal_entry_id and public.has_org_role(e.org_id, 'viewer')
    )
    and (journal_lines.property_id is null or public.has_property_access(journal_lines.property_id, 'read_only'))
  );

create policy "journal_lines_insert_accountant_plus_and_property_access"
  on public.journal_lines for insert
  with check (
    exists (
      select 1 from public.journal_entries e
      where e.id = journal_lines.journal_entry_id and public.has_org_role(e.org_id, 'accountant')
    )
    and (
      journal_lines.property_id is null
      or public.has_property_access(journal_lines.property_id, 'accountant')
      or public.has_property_access(journal_lines.property_id, 'owner')
    )
  );
