import { NextResponse, type NextRequest } from 'next/server';
import { expenseRecordSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapExpenseRow } from '@/lib/accounting';

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/v1/expenses/:id/record -- thin wrapper over record_expense() (migration 20260101000038). */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

  let body: unknown = {};
  const rawBody = await request.text();
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } },
        { status: 400 },
      );
    }
  }

  const parsed = expenseRecordSchema.safeParse(body);
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

  const { error: recordError } = await supabase.rpc('record_expense', {
    p_expense_id: id,
    p_paid_immediately: parsed.data.paidImmediately,
  });

  if (recordError) {
    return NextResponse.json(
      { error: { code: 'expense_record_failed', message: recordError.message } },
      { status: 500 },
    );
  }

  const { data, error: fetchError } = await supabase.from('expenses').select('*').eq('id', id).single();
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'expense_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ expense: mapExpenseRow(data) });
}
