import { NextResponse, type NextRequest } from 'next/server';
import { organizationUpdateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapOrganizationRow } from '@/lib/organizations';
import { requireOrgRole } from '@/lib/portfolio';

type RouteParams = { params: Promise<{ orgId: string }> };

// GET/PATCH /api/v1/organizations/:orgId (PWA_V1_COMPLETION_PLAN.md #8). Same "SELECT through the
// caller's own RLS-scoped client first, 404 (never 403) if it's hidden" org-enumeration-safe
// pattern as properties/[id]/route.ts -- organizations_select_org_member (migration
// 20260101000018) already scopes GET to the caller's own org membership, so a wrong-org id 404s
// naturally. PATCH's role floor (manager) is enforced twice: here (fail-fast 403) and by
// organizations_update_manager_plus (migration 20260101000021, the actual ground truth) --
// PERMISSIONS.md layer 2.
async function loadVisibleOrganization(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  orgId: string,
) {
  return supabase.from('organizations').select('*').eq('id', orgId).maybeSingle();
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { orgId } = await params;
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

  const { data, error } = await loadVisibleOrganization(supabase, orgId);
  if (error) {
    return NextResponse.json(
      { error: { code: 'organization_fetch_failed', message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Organization not found.' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ organization: mapOrganizationRow(data) });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { orgId } = await params;
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

  const { data: existing, error: fetchError } = await loadVisibleOrganization(supabase, orgId);
  if (fetchError) {
    return NextResponse.json(
      { error: { code: 'organization_fetch_failed', message: fetchError.message } },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Organization not found.' } },
      { status: 404 },
    );
  }

  const canWrite = await requireOrgRole(supabase, orgId, 'manager');
  if (!canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'You do not have permission to edit this organization.',
        },
      },
      { status: 403 },
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

  const parsed = organizationUpdateSchema.safeParse(body);
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

  const patch: Record<string, unknown> = {};
  if (parsed.data.legalName !== undefined) patch.legal_name = parsed.data.legalName;
  if (parsed.data.tradingName !== undefined) patch.trading_name = parsed.data.tradingName;
  if (parsed.data.cipcRegNo !== undefined) patch.cipc_reg_no = parsed.data.cipcRegNo;
  if (parsed.data.vatNo !== undefined) patch.vat_no = parsed.data.vatNo;
  if (parsed.data.sarsTaxNo !== undefined) patch.sars_tax_no = parsed.data.sarsTaxNo;
  if (parsed.data.popiaInformationOfficer !== undefined)
    patch.popia_information_officer = parsed.data.popiaInformationOfficer;
  if (parsed.data.invoicePrefix !== undefined) patch.invoice_prefix = parsed.data.invoicePrefix;
  if (parsed.data.depositInterestPct !== undefined)
    patch.deposit_interest_pct = parsed.data.depositInterestPct;
  if (parsed.data.ffcNumber !== undefined) patch.ffc_number = parsed.data.ffcNumber;
  if (parsed.data.ffcIssued !== undefined) patch.ffc_issued = parsed.data.ffcIssued;
  if (parsed.data.ffcExpires !== undefined) patch.ffc_expires = parsed.data.ffcExpires;
  if (parsed.data.supportContactName !== undefined)
    patch.support_contact_name = parsed.data.supportContactName;
  if (parsed.data.supportPhone !== undefined) patch.support_phone = parsed.data.supportPhone;
  if (parsed.data.supportEmail !== undefined) patch.support_email = parsed.data.supportEmail;
  if (parsed.data.communicationFooter !== undefined)
    patch.communication_footer = parsed.data.communicationFooter;

  const { data, error } = await supabase
    .from('organizations')
    .update(patch)
    .eq('id', orgId)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: 'organization_update_failed', message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ organization: mapOrganizationRow(data) });
}
