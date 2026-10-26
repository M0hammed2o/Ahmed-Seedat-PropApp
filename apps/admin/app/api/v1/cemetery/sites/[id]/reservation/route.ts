import { NextResponse, type NextRequest } from 'next/server';
import { parseJson } from '@/lib/smartUtility/http';
import { requireCemeteryApi, cemeteryNotFound, UUID } from '@/lib/cemetery/http';
import { cemeteryDbError } from '@/lib/cemetery/errors';
import { reservationSchema } from '@/lib/cemetery/schemas';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/cemetery/sites/:id/reservation — reserve an available site for a purchaser (manager+). */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!UUID.test(id)) return cemeteryNotFound('Grave site');
  const auth = await requireCemeteryApi('manage');
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, reservationSchema);
  if ('response' in parsed) return parsed.response;
  const { error } = await auth.supabase.rpc('cemetery_reserve_site', {
    p_site_id: id,
    p_purchaser_id: parsed.data.purchaserId,
    p_reserved_until: parsed.data.reservedUntil ?? null,
    p_notes: parsed.data.notes,
  });
  if (error) return cemeteryDbError(error, 'Could not reserve the grave site.', 'sites.reserve');
  return NextResponse.json({ ok: true });
}

/** DELETE /api/v1/cemetery/sites/:id/reservation — release a reservation; the site becomes available (manager+). */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!UUID.test(id)) return cemeteryNotFound('Grave site');
  const auth = await requireCemeteryApi('manage');
  if ('response' in auth) return auth.response;
  const { error } = await auth.supabase.rpc('cemetery_release_reservation', { p_site_id: id });
  if (error) return cemeteryDbError(error, 'Could not release the reservation.', 'sites.release');
  return NextResponse.json({ ok: true });
}
