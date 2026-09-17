import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPortfolioInsightRow } from '@/lib/ai';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/insights/:id/acknowledge (Android V1 cleanup pass, 2026-09-17).
 *
 * The honest counterpart to dismissing. Dismissing is for an alert the user does not want to see
 * again; acknowledging is for one whose condition is STILL TRUE -- overdue rent, an over-budget
 * property -- where hiding it must not imply the underlying fact went away. It sets
 * acknowledged_at, which takes the alert out of the Needs-attention feed while leaving the row
 * unresolved, and the reconciler brings it back the moment the alert's severity or message changes.
 *
 * It changes no business data whatsoever: no invoice is marked paid, no ticket is closed.
 */
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

  // RLS (portfolio_insights_update_same_org) is the real authorization check -- a caller outside the
  // organisation updates nothing and gets the same not-found answer as a bad id.
  const { data, error } = await supabase
    .from('portfolio_insights')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: { code: 'insight_acknowledge_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'This alert no longer exists.' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ insight: mapPortfolioInsightRow(data) });
}
