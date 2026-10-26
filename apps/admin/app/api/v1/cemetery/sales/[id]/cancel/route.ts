import { NextResponse, type NextRequest } from 'next/server';
import { parseJson } from '@/lib/smartUtility/http';
import { requireCemeteryApi, cemeteryNotFound, UUID } from '@/lib/cemetery/http';
import { cemeteryDbError } from '@/lib/cemetery/errors';
import { cancelSchema } from '@/lib/cemetery/schemas';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/cemetery/sales/:id/cancel — cancel a sale / grant of rights (manager+). The site becomes available;
 * payments already received stay recorded. Refused once a burial is recorded under the sale. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!UUID.test(id)) return cemeteryNotFound('Sale');
  const auth = await requireCemeteryApi('manage');
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, cancelSchema);
  if ('response' in parsed) return parsed.response;
  const { error } = await auth.supabase.rpc('cemetery_cancel_sale', {
    p_sale_id: id,
    p_reason: parsed.data.reason,
    p_cancelled_on: parsed.data.cancelledOn ?? null,
  });
  if (error) return cemeteryDbError(error, 'Could not cancel the sale.', 'sales.cancel');
  return NextResponse.json({ ok: true });
}
