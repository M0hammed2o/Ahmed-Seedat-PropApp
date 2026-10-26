import { NextResponse, type NextRequest } from 'next/server';
import { parseJson } from '@/lib/smartUtility/http';
import { requireCemeteryApi, cemeteryNotFound, UUID } from '@/lib/cemetery/http';
import { cemeteryDbError } from '@/lib/cemetery/errors';
import { purchaserSchema, purchaserRow } from '@/lib/cemetery/schemas';

type RouteParams = { params: Promise<{ id: string }> };

/** PATCH /api/v1/cemetery/purchasers/:id — update a purchaser's contact and next-of-kin details (manager+). */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!UUID.test(id)) return cemeteryNotFound('Purchaser');
  const auth = await requireCemeteryApi('manage');
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, purchaserSchema);
  if ('response' in parsed) return parsed.response;
  const { data, error } = await auth.supabase
    .from('cemetery_purchasers')
    .update(purchaserRow(parsed.data))
    .eq('id', id)
    .select('id, full_name')
    .maybeSingle();
  if (error) return cemeteryDbError(error, 'Could not update the purchaser.', 'purchasers.update');
  if (!data) return cemeteryNotFound('Purchaser');
  return NextResponse.json({ purchaser: data });
}
