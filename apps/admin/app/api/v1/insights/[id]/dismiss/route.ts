import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPortfolioInsightRow } from '@/lib/ai';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/insights/:id/dismiss (API_SPEC.md §9). Org viewer+ per `portfolio_insights_dismiss_org`. */
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

  const { data, error } = await supabase
    .from('portfolio_insights')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: { code: 'dismiss_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Insight not found.' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ insight: mapPortfolioInsightRow(data) });
}
