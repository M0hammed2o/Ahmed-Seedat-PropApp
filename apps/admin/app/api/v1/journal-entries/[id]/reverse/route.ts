import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapJournalEntryRow } from '@/lib/accounting';

type RouteParams = { params: Promise<{ id: string }> };

const reverseSchema = z.object({
  reversalEntryDate: z.string().optional(),
  reason: z.string().max(2000).optional(),
});

/**
 * POST /api/v1/journal-entries/:id/reverse (API_SPEC.md §6: "never PATCH/DELETE on journal-entries
 * directly -- no such endpoint exists"). Thin wrapper over reverse_journal_entry()
 * (supabase/migrations/20260101000035) -- all the real validation (balance, period lock,
 * already-reversed, is-itself-a-reversal) lives in that function, tested directly in
 * supabase/tests/accounting_core.test.sql.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
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

  const { data: entry, error: entryError } = await supabase
    .from('journal_entries')
    .select('id, org_id')
    .eq('id', id)
    .maybeSingle();
  if (entryError) {
    return NextResponse.json(
      { error: { code: 'journal_entry_fetch_failed', message: entryError.message } },
      { status: 500 },
    );
  }
  if (!entry) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Journal entry not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, entry.org_id, 'accountant');
  if (!canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'You do not have permission to reverse this journal entry.' } },
      { status: 403 },
    );
  }

  let body: unknown = {};
  const rawBody = await request.text();
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
        { status: 400 },
      );
    }
  }

  const parsed = reverseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          field_errors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const { data: reversalId, error: reverseError } = await supabase.rpc('reverse_journal_entry', {
    p_entry_id: id,
    p_reversal_entry_date: parsed.data.reversalEntryDate ?? new Date().toISOString().slice(0, 10),
    p_reason: parsed.data.reason ?? null,
  });

  if (reverseError) {
    return NextResponse.json(
      { error: { code: 'reversal_failed', message: reverseError.message } },
      { status: 500 },
    );
  }

  const { data: reversalEntry, error: fetchError } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('id', reversalId)
    .single();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'journal_entry_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ journalEntry: mapJournalEntryRow(reversalEntry) }, { status: 201 });
}
