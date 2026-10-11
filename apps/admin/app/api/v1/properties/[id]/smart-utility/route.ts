import { NextResponse, type NextRequest } from 'next/server';
import { loadReadableProperty, notFound, requireUser, serverError, utilitiesDisabled } from '@/lib/smartUtility/http';
import { loadSmartUtilityOverview } from '@/lib/smartUtility/overview';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/properties/:id/smart-utility -- the Smart Utility Monitoring dashboard payload
 * (docs/SMART_UTILITY_ARCHITECTURE.md §10): meters + health, period-to-date consumption and cost,
 * 30-day daily series, reconciliation, alerts, submission settings/recipients/history. Every query
 * runs on the caller's session, so RLS (can_read_property_utilities) scopes all of it.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const property = await loadReadableProperty(auth.supabase, id);
  if (!property) return notFound();
  if (!property.utilities_enabled) return utilitiesDisabled();
  try {
    const overview = await loadSmartUtilityOverview(auth.supabase, id);
    return NextResponse.json({ property, ...overview });
  } catch (error) {
    return serverError('smart_utility_overview_failed', 'Could not load utility monitoring.', 'smart_utility.overview', error);
  }
}
