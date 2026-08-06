import { NextResponse, type NextRequest } from 'next/server';
import type { TaxPackLine } from '@propvault/types';
import { getServerSupabaseClient } from '@/lib/supabase/server';

/**
 * GET /api/v1/tax-pack?org_id=...&tax_year=2027 (API_SPEC.md §6, ACCOUNTING.md §7) -- computed
 * live from compute_tax_pack(), never a stored table. Property names resolved here (the RPC only
 * returns property_id) rather than inside the SQL function, matching this codebase's existing
 * "joins/name-resolution at the API layer" convention for list endpoints.
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

  const url = new URL(request.url);
  const orgId = url.searchParams.get('org_id');
  const taxYearParam = url.searchParams.get('tax_year');
  const taxYear = taxYearParam ? Number(taxYearParam) : NaN;

  if (!orgId || !Number.isInteger(taxYear)) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'org_id and a numeric tax_year are required.',
        },
      },
      { status: 400 },
    );
  }

  const { data: rows, error } = await supabase.rpc('compute_tax_pack', {
    p_org_id: orgId,
    p_tax_year: taxYear,
  });

  if (error) {
    return NextResponse.json(
      { error: { code: 'tax_pack_compute_failed', message: error.message } },
      { status: 422 },
    );
  }

  const typedRows = (rows ?? []) as Array<{
    property_id: string | null;
    account_type: 'income' | 'expense';
    account_code: string;
    account_name: string;
    amount: number;
  }>;

  const propertyIds = Array.from(
    new Set(typedRows.map((r) => r.property_id).filter((id): id is string => !!id)),
  );
  const propertyNames = new Map<string, string>();
  if (propertyIds.length > 0) {
    const { data: properties } = await supabase
      .from('properties')
      .select('id, nickname')
      .in('id', propertyIds);
    for (const p of properties ?? []) propertyNames.set(p.id, p.nickname);
  }

  const lines: TaxPackLine[] = typedRows.map((r) => ({
    propertyId: r.property_id,
    propertyName: r.property_id ? (propertyNames.get(r.property_id) ?? null) : null,
    accountType: r.account_type,
    accountCode: r.account_code,
    accountName: r.account_name,
    amount: r.amount,
  }));

  const totalIncome = lines
    .filter((l) => l.accountType === 'income')
    .reduce((sum, l) => sum + l.amount, 0);
  const totalExpenses = lines
    .filter((l) => l.accountType === 'expense')
    .reduce((sum, l) => sum + l.amount, 0);

  return NextResponse.json({
    taxYear,
    lines,
    totalIncome,
    totalExpenses,
    netIncome: totalIncome - totalExpenses,
    disclaimer:
      'This tax pack is not tax advice. Income shown is payments actually received in the period and expenses come from the ledger — bond interest, wear-and-tear, and other allowances are not tracked or estimated. Confirm treatment with SARS or a registered tax practitioner before filing.',
  });
}
