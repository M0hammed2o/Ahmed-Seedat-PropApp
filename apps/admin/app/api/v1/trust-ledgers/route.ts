import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapTrustLedgerRow } from '@/lib/accounting';

/**
 * GET /api/v1/trust-ledgers?tenant_id=... (API_SPEC.md §6 documents `/api/v1/trust-ledgers/:tenantId`;
 * implemented as a query filter on the collection route instead, consistent with every other list
 * endpoint's `filter[...]` convention in this API rather than introducing a differently-shaped
 * path-param route for this one resource).
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
  const tenantId = url.searchParams.get('tenant_id');
  const orgId = url.searchParams.get('org_id');

  let query = supabase.from('trust_ledgers').select('*').order('created_at', { ascending: false });
  if (tenantId) query = query.eq('tenant_id', tenantId);
  if (orgId) query = query.eq('org_id', orgId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: 'trust_ledgers_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ trustLedgers: (data ?? []).map(mapTrustLedgerRow) });
}
