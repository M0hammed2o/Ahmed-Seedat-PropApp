import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapOwnerStatementRow } from '@/lib/accounting';

/**
 * GET /api/v1/owner-statements (API_SPEC.md §6) -- list, filterable by org_id/owner_id/status.
 * No POST here -- statements are never hand-created (ACCOUNTING.md §5 "generated, not
 * hand-entered"); creation only happens via POST /api/v1/owner-statements/draft.
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

  const url = new URL(request.url);
  const orgId = url.searchParams.get('org_id');
  const ownerId = url.searchParams.get('owner_id');
  const status = url.searchParams.get('status');

  let query = supabase
    .from('owner_statements')
    .select('*')
    .order('period_start', { ascending: false });
  if (orgId) query = query.eq('org_id', orgId);
  if (ownerId) query = query.eq('owner_id', ownerId);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: 'owner_statements_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ ownerStatements: (data ?? []).map(mapOwnerStatementRow) });
}
