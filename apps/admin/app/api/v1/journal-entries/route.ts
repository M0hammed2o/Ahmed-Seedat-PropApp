import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapJournalEntryRow } from '@/lib/accounting';
import { parseListQuery, encodeCursor } from '@/lib/cursorPagination';

/**
 * GET /api/v1/journal-entries -- read-only. There is deliberately no POST here: ACCOUNTING.md §3
 * -- "no generic post a journal entry API exists" -- every journal entry is created by a typed
 * server-side operation calling post_journal_entry()/reverse_journal_entry() directly (M14's next
 * increment builds those typed operations as each product flow -- rent invoicing, expense
 * recording, payment confirmation -- is wired up), never by a client posting a free-form entry
 * shape to this endpoint.
 */
export async function GET(request: NextRequest) {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  const { limit, cursor } = parseListQuery(request);
  const url = new URL(request.url);
  const orgIdFilter = url.searchParams.get('filter[org_id]');
  const sourceTypeFilter = url.searchParams.get('filter[source_type]');
  const fromDate = url.searchParams.get('filter[entry_date_from]');
  const toDate = url.searchParams.get('filter[entry_date_to]');

  let query = supabase
    .from('journal_entries')
    .select('*')
    .order('posted_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (orgIdFilter) query = query.eq('org_id', orgIdFilter);
  if (sourceTypeFilter) query = query.eq('source_type', sourceTypeFilter);
  if (fromDate) query = query.gte('entry_date', fromDate);
  if (toDate) query = query.lte('entry_date', toDate);
  // Cursor pagination here keys off posted_at, not created_at (journal_entries has no
  // created_at/updated_at columns by design -- posted_at is the one immutable timestamp).
  if (cursor)
    query = query.or(
      `posted_at.lt.${cursor.createdAt},and(posted_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: 'journal_entries_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  const rows = data ?? [];
  const journalEntries = rows.map(mapJournalEntryRow);
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last ? encodeCursor({ createdAt: last.posted_at, id: last.id }) : null;

  return NextResponse.json({ journalEntries, next_cursor: nextCursor });
}
