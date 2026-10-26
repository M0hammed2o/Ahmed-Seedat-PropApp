import { NextResponse, type NextRequest } from 'next/server';
import { parseJson } from '@/lib/smartUtility/http';
import { requireCemeteryApi, cemeteryNotFound, UUID } from '@/lib/cemetery/http';
import { cemeteryDbError } from '@/lib/cemetery/errors';
import { paymentSchema } from '@/lib/cemetery/schemas';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/cemetery/sales/:id/payments — record a received payment against a sale and issue its receipt
 * (accountant+). Never above the balance due (enforced in the database, under a lock on the sale). No payment is
 * collected or requested from anyone. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!UUID.test(id)) return cemeteryNotFound('Sale');
  const auth = await requireCemeteryApi('payments');
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, paymentSchema);
  if ('response' in parsed) return parsed.response;
  const d = parsed.data;
  const { data, error } = await auth.supabase.rpc('cemetery_record_payment', {
    p_sale_id: id,
    p_amount: d.amount,
    p_paid_on: d.paidOn,
    p_method: d.method,
    p_reference: d.reference,
    p_notes: d.notes,
  });
  if (error) return cemeteryDbError(error, 'Could not record the payment.', 'sales.payment');
  return NextResponse.json({ payment: data }, { status: 201 });
}
