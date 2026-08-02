import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapOwnerStatementRow } from '@/lib/accounting';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/owner-statements/:id/issue (API_SPEC.md §6) -- freezes a draft statement. */
export async function POST(_request: NextRequest, { params }: RouteParams) {
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

  const { error: issueError } = await supabase.rpc('issue_owner_statement', {
    p_owner_statement_id: id,
  });
  if (issueError) {
    return NextResponse.json(
      { error: { code: 'owner_statement_issue_failed', message: issueError.message } },
      { status: 422 },
    );
  }

  const { data, error: fetchError } = await supabase.from('owner_statements').select('*').eq('id', id).single();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'owner_statement_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ ownerStatement: mapOwnerStatementRow(data) });
}
