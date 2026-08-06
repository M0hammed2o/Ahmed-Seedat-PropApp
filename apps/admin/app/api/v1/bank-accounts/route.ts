import { NextResponse, type NextRequest } from 'next/server';
import { bankAccountCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapBankAccountRow } from '@/lib/accounting';

/** GET/POST /api/v1/bank-accounts (API_SPEC.md §6). Accountant+ throughout. */
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
  const orgIdFilter = url.searchParams.get('filter[org_id]');

  let query = supabase.from('bank_accounts').select('*').eq('is_active', true).order('bank_name');
  if (orgIdFilter) query = query.eq('org_id', orgIdFilter);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: { code: 'bank_accounts_list_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ bankAccounts: (data ?? []).map(mapBankAccountRow) });
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

  const parsed = bankAccountCreateSchema.safeParse(body);
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

  const canWrite = await requireOrgRole(supabase, parsed.data.orgId, 'accountant');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to add bank accounts for this organization.',
        },
      },
      { status: 403 },
    );
  }

  // account_number_ref (encrypted_secrets pointer) is deliberately not settable here -- the
  // encryption pipeline isn't built yet (TECHNICAL_DEBT_REGISTER.md TD-18), same reasoning as
  // tenants.id_number_ref/owners.banking_ref.
  const { data, error } = await supabase
    .from('bank_accounts')
    .insert({
      org_id: parsed.data.orgId,
      account_class: parsed.data.accountClass,
      bank_name: parsed.data.bankName,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'bank_account_create_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ bankAccount: mapBankAccountRow(data) }, { status: 201 });
}
