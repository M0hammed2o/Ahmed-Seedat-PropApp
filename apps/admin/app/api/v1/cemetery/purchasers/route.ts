import { NextResponse, type NextRequest } from 'next/server';
import { parseJson } from '@/lib/smartUtility/http';
import { requireCemeteryApi } from '@/lib/cemetery/http';
import { cemeteryDbError } from '@/lib/cemetery/errors';
import { purchaserSchema, purchaserRow } from '@/lib/cemetery/schemas';

/** POST /api/v1/cemetery/purchasers — add a purchaser / rights holder (manager+). Not a tenant: no login, no portal,
 * no messages are ever sent to them by this module. */
export async function POST(request: NextRequest) {
  const auth = await requireCemeteryApi('manage');
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, purchaserSchema);
  if ('response' in parsed) return parsed.response;
  const { data, error } = await auth.supabase
    .from('cemetery_purchasers')
    .insert({ org_id: auth.ctx.orgId, ...purchaserRow(parsed.data), created_by: auth.user.id })
    .select('id, full_name')
    .single();
  if (error) return cemeteryDbError(error, 'Could not save the purchaser.', 'purchasers.create');
  return NextResponse.json({ purchaser: data }, { status: 201 });
}
