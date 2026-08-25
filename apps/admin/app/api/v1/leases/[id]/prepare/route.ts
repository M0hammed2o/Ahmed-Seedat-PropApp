import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapLeasePreparationRow } from '@/lib/leasing';

type RouteParams = { params: Promise<{ id: string }> };

/** GET /api/v1/leases/:id/prepare -- the lease_preparations row for the lease-preparation UI
 * (Phase O). Returns leasePreparation: null when no document has ever been generated/uploaded yet
 * (the row only exists from the first document version onward, createLeaseDocumentVersion()). */
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

  const { data, error } = await supabase
    .from('lease_preparations')
    .select('*')
    .eq('lease_id', id)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: { code: 'lease_preparation_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ leasePreparation: data ? mapLeasePreparationRow(data) : null });
}
