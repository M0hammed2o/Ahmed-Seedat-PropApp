import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapOwnerStatementRow } from '@/lib/accounting';

type RouteParams = { params: Promise<{ id: string }> };

/** GET /api/v1/owner-statements/:id (API_SPEC.md §6). */
export async function GET(_request: NextRequest, { params }: RouteParams) {
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

  const { data, error } = await supabase.from('owner_statements').select('*').eq('id', id).single();
  if (error || !data) {
    return NextResponse.json(
      {
        error: {
          code: 'owner_statement_not_found',
          message: error?.message ?? 'Owner statement not found.',
        },
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ ownerStatement: mapOwnerStatementRow(data) });
}
