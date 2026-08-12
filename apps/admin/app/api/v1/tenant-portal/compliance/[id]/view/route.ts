import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/tenant-portal/compliance/:id/view -- called when a tenant opens a rule document
 * (PHASE 4/5: "viewing must NOT mean acknowledged"). Thin wrapper over
 * mark_compliance_requirement_viewed(), which only ever advances PENDING -> VIEWED and is a no-op
 * for anything already further along.
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

  const { error } = await supabase.rpc('mark_compliance_requirement_viewed', {
    p_requirement_id: id,
  });
  if (error) {
    return NextResponse.json(
      { error: { code: 'view_mark_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ viewed: true });
}
