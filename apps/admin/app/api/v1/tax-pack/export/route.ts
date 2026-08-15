import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { canUseAdvancedReporting } from '@/lib/subscriptionEntitlements';

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * GET /api/v1/tax-pack/export?org_id=...&tax_year=2027 -- CSV download (ACCOUNTING.md §7's "CSV
 * and/or PDF output"; CSV chosen for V1 since no PDF-generation dependency exists in this
 * codebase yet, same scope decision as Owner Statements' print-to-PDF). Downloading IS exporting,
 * so this route also calls record_tax_pack_export() as a side effect -- the audit trail
 * ACCOUNTING.md §7 requires. Viewing the on-screen JSON summary (GET /api/v1/tax-pack) does not
 * record an export; only an actual download does.
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

  // RELEASE A P0 fix: the tax-pack CSV export is the real, gated "advanced reporting" surface
  // (feature_limits.advancedReporting) -- the compute_tax_pack RPC call above already proved
  // org-role access (accountant+, checked inside the RPC itself), so this only needs the plan
  // check, not a repeated role check.
  if (!(await canUseAdvancedReporting(supabase, orgId))) {
    return NextResponse.json(
      {
        error: {
          code: 'feature_not_available',
          message: 'Tax pack export is not included in your current plan.',
          upgradeRequired: true,
        },
      },
      { status: 403 },
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

  const { error: exportError } = await supabase.rpc('record_tax_pack_export', {
    p_org_id: orgId,
    p_tax_year: taxYear,
  });
  if (exportError) {
    return NextResponse.json(
      { error: { code: 'tax_pack_export_record_failed', message: exportError.message } },
      { status: 422 },
    );
  }

  const header = 'Property,Account Type,Account Code,Account Name,Amount (ZAR)';
  const csvRows = typedRows.map((r) =>
    [
      csvEscape(
        r.property_id ? (propertyNames.get(r.property_id) ?? 'Unknown property') : 'Unattributed',
      ),
      csvEscape(r.account_type),
      csvEscape(r.account_code),
      csvEscape(r.account_name),
      r.amount.toFixed(2),
    ].join(','),
  );
  const disclaimer =
    '# Not tax advice. Income shown is payments actually received; expenses come from the ledger. Bond interest, wear-and-tear, and other allowances are not tracked. Confirm treatment with SARS or a registered tax practitioner before filing.';
  const csv = [disclaimer, header, ...csvRows].join('\n');

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tax-pack-${taxYear}.csv"`,
    },
  });
}
