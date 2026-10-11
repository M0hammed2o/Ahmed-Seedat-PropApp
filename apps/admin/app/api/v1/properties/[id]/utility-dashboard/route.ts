import { NextResponse, type NextRequest } from 'next/server';
import { jsonError, loadReadableProperty, notFound, requireUser, serverError, utilitiesDisabled } from '@/lib/smartUtility/http';
import { loadHybridDashboard, parseRange } from '@/lib/smartUtility/hybridDashboard';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/properties/:id/utility-dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD (to exclusive; default the last
 * 30 days; at most 366) — hybrid supply balance (grid, solar, battery, generator, municipal, borehole, tanks,
 * tankers), source-mix series, recovery vs estimated supply cost, source status and per-unit use. RLS-scoped.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const range = parseRange(request.nextUrl.searchParams.get('from'), request.nextUrl.searchParams.get('to'));
  if ('error' in range) return jsonError(400, 'invalid_range', range.error);
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!property.utilities_enabled) return utilitiesDisabled();
  try {
    return NextResponse.json(await loadHybridDashboard(auth.supabase, property.id, range));
  } catch (error) {
    return serverError('utility_dashboard_failed', 'Could not load the utilities dashboard.', 'utility_dashboard.load', error);
  }
}
