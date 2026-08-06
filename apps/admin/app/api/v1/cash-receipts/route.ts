import { NextResponse, type NextRequest } from 'next/server';
import { cashReceiptCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapCashReceiptRow } from '@/lib/accounting';
import { parseListQuery, encodeCursor, beforeCursorFilter } from '@/lib/cursorPagination';

/**
 * GET/POST /api/v1/cash-receipts (Stage 3 Phase 7, commercial-launch execution plan). POST is a
 * thin wrapper over record_cash_receipt() (migration 20260101000073) -- logs a physically-received
 * cash payment; confirming the bank deposit is the separate POST /:id/confirm-deposit action,
 * mirroring expenses' create-then-record two-step pattern.
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

  const { limit, cursor } = parseListQuery(request);
  const url = new URL(request.url);
  const propertyIdFilter = url.searchParams.get('filter[property_id]');

  let query = supabase
    .from('cash_receipts')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (propertyIdFilter) query = query.eq('property_id', propertyIdFilter);
  if (cursor) query = query.or(beforeCursorFilter(cursor));

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: 'cash_receipts_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  const rows = data ?? [];
  const cashReceipts = rows.map(mapCashReceiptRow);
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({ createdAt: last.created_at, id: last.id })
      : null;

  return NextResponse.json({ cashReceipts, next_cursor: nextCursor });
}

export async function POST(request: NextRequest) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = cashReceiptCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          field_errors: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const { data: receiptId, error: recordError } = await supabase.rpc('record_cash_receipt', {
    p_org_id: parsed.data.orgId,
    p_property_id: parsed.data.propertyId,
    p_amount: parsed.data.amount,
    p_lease_id: parsed.data.leaseId ?? null,
    p_rent_schedule_id: parsed.data.rentScheduleId ?? null,
    p_document_id: parsed.data.documentId ?? null,
  });
  if (recordError) {
    return NextResponse.json(
      { error: { code: 'cash_receipt_create_failed', message: recordError.message } },
      { status: 422 },
    );
  }

  const { data, error } = await supabase
    .from('cash_receipts')
    .select('*')
    .eq('id', receiptId)
    .single();
  if (error) {
    return NextResponse.json(
      { error: { code: 'cash_receipt_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ cashReceipt: mapCashReceiptRow(data) }, { status: 201 });
}
