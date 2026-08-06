import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPortfolioInsightRow } from '@/lib/ai';

/**
 * GET /api/v1/insights (API_SPEC.md §9) -- Portfolio Intelligence feed. `filter[org_id]` is
 * required; RLS (`portfolio_insights_select_org`) is the actual scoping enforcement, matching
 * every other list endpoint in this codebase. Dismissed insights are excluded by default (the
 * feed showing a dismissed item back would defeat the point of dismissing it).
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
  const orgId = url.searchParams.get('filter[org_id]');
  if (!orgId) {
    return NextResponse.json(
      { error: { code: 'missing_org_id', message: 'filter[org_id] is required.' } },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('portfolio_insights')
    .select('*')
    .eq('org_id', orgId)
    .is('dismissed_at', null)
    .order('severity', { ascending: false })
    .order('generated_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: { code: 'insights_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ insights: (data ?? []).map(mapPortfolioInsightRow) });
}
