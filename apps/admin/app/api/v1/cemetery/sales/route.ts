import { NextResponse, type NextRequest } from 'next/server';
import { parseJson } from '@/lib/smartUtility/http';
import { requireCemeteryApi } from '@/lib/cemetery/http';
import { cemeteryDbError } from '@/lib/cemetery/errors';
import { purchaserRow, saleSchema } from '@/lib/cemetery/schemas';

/**
 * POST /api/v1/cemetery/sales — the grave-site sale workflow (manager+):
 *   site -> purchaser (existing, or created here) -> price -> optional deposit -> sale record + receipt -> site sold.
 * cemetery_record_sale() does the sale, deposit and status change in ONE transaction with the site row locked; the
 * database refuses a second sale of the same site (409). No payment is taken or requested: a deposit is a record of
 * money the cemetery says it received (and is flagged as a demonstration transaction under a demo cemetery).
 */
export async function POST(request: NextRequest) {
  const auth = await requireCemeteryApi('manage');
  if ('response' in auth) return auth.response;
  const parsed = await parseJson(request, saleSchema);
  if ('response' in parsed) return parsed.response;
  const d = parsed.data;
  const { supabase, ctx, user } = auth;

  const { data: site } = await supabase
    .from('cemetery_sites')
    .select('id, org_id, sale_status, reference')
    .eq('id', d.siteId)
    .maybeSingle();
  if (!site)
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Grave site not found.' } },
      { status: 404 },
    );
  if (site.sale_status === 'sold') {
    return NextResponse.json(
      {
        error: {
          code: 'cemetery_site_already_sold',
          message: `Grave site ${site.reference} has already been sold.`,
        },
      },
      { status: 409 },
    );
  }

  let purchaserId = d.purchaserId ?? null;
  let createdPurchaser = false;
  if (!purchaserId && d.newPurchaser) {
    const { data: created, error: pErr } = await supabase
      .from('cemetery_purchasers')
      .insert({
        org_id: site.org_id ?? ctx.orgId,
        ...purchaserRow(d.newPurchaser),
        created_by: user.id,
      })
      .select('id')
      .single();
    if (pErr) return cemeteryDbError(pErr, 'Could not save the purchaser.', 'sales.purchaser');
    purchaserId = created.id;
    createdPurchaser = true;
  }

  const { data, error } = await supabase.rpc('cemetery_record_sale', {
    p_site_id: d.siteId,
    p_purchaser_id: purchaserId,
    p_price: d.price,
    p_sale_date: d.saleDate,
    p_deposit: d.deposit,
    p_method: d.method,
    p_reference: d.reference,
    p_notes: d.notes,
  });
  if (error) {
    const response = cemeteryDbError(error, 'Could not record the sale.', 'sales.create');
    // The purchaser created for this attempt stays (it is a valid record and is reusable on retry).
    if (createdPurchaser) {
      const body = await response.json();
      return NextResponse.json({ ...body, purchaserId }, { status: response.status });
    }
    return response;
  }
  const result = data as {
    sale_id: string;
    sale_number: string;
    payment_id: string | null;
    receipt_number: string | null;
    is_demo: boolean;
  };
  return NextResponse.json({ sale: result }, { status: 201 });
}
