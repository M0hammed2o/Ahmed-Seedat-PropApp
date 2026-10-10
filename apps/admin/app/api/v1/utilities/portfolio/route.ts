import { NextResponse, type NextRequest } from 'next/server';
import { requireUser, serverError } from '@/lib/smartUtility/http';
import { loadUtilityPortfolio } from '@/lib/smartUtility/portfolio';

/**
 * GET /api/v1/utilities/portfolio?months=12 — utilities across every property the caller can read: open alerts,
 * charges awaiting approval, unpaid utility invoices, last-period consumption and the monthly trend. RLS-scoped.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  const months = Number(request.nextUrl.searchParams.get('months') ?? 12);
  try {
    return NextResponse.json(await loadUtilityPortfolio(auth.supabase, { months: Number.isFinite(months) ? months : 12 }));
  } catch (error) {
    return serverError('utility_portfolio_failed', 'Could not load the utilities portfolio.', 'utility_portfolio.load', error);
  }
}
