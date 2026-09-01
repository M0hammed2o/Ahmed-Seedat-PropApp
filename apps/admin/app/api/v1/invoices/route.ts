import { NextResponse, type NextRequest } from 'next/server';
import { manualInvoiceCreateSchema } from '@propvault/validation';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { requireOrgRole } from '@/lib/portfolio';
import { mapInvoiceRow } from '@/lib/accounting';
import { loadInvoicesWithBalances } from '@/lib/invoicing';
import { safeErrorMessage } from '@/lib/safeError';

/**
 * GET /api/v1/invoices -- Android V1 completion pass (WORKLOG.md this date): the one JSON list
 * endpoint behind both the owner/staff and tenant native invoice screens. No mobile-only logic --
 * calls the EXACT same `loadInvoicesWithBalances()` the web `/accounting/invoices` page and
 * tenant `/my-payments` page already trust for paid/balance/status (`amount`, `paid`, `balance`,
 * `displayStatus` are never recomputed here or on-device). Deliberately unfiltered: RLS alone
 * decides which rows come back (`invoices_select_org_member` for staff, `invoices_select_tenant_
 * self` for a tenant, migration 20260101000162's issued-only tightening applies exactly as it
 * does everywhere else) -- the same "never re-implement authorization, trust RLS" posture as
 * every other list route (e.g. GET /api/v1/invoices/:id/payments below, which has never had an
 * explicit role check for this same reason).
 */
export async function GET() {
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

  try {
    const invoices = await loadInvoicesWithBalances(supabase);
    return NextResponse.json({ invoices });
  } catch (error) {
    // loadInvoicesWithBalances() throws a plain Error, not a Supabase {message} result --
    // safeErrorMessage()'s own signature expects the latter, so this narrows by hand rather than
    // reusing it against an `unknown` catch variable it was never designed for.
    console.error('[invoices.list]', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: { code: 'invoices_fetch_failed', message: 'Could not load invoices.' } },
      { status: 500 },
    );
  }
}

/**
 * POST /api/v1/invoices -- overnight V1 completion pass, Part B. The manual (non-rent) tenant
 * invoice creation path: utilities, parking, repairs, deposit-related charges, etc. Always inserts
 * as status='draft' via create_manual_invoice() (migration 20260101000152) -- a separate RPC from
 * invoice_rent_schedule(), never touching rent_schedules. No journal entry is posted until the
 * invoice is explicitly issued (POST /api/v1/invoices/:id/issue).
 */
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

  const parsed = manualInvoiceCreateSchema.safeParse(body);
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
      { error: { code: 'forbidden', message: 'You do not have permission to create invoices for this organization.' } },
      { status: 403 },
    );
  }

  const { data: invoiceId, error } = await supabase.rpc('create_manual_invoice', {
    p_org_id: parsed.data.orgId,
    p_lease_id: parsed.data.leaseId,
    p_tenant_id: parsed.data.tenantId,
    p_invoice_date: parsed.data.invoiceDate,
    p_due_date: parsed.data.dueDate,
    p_reference: parsed.data.reference ?? null,
    p_description: parsed.data.description ?? null,
    p_notes: parsed.data.notes ?? null,
    p_line_items: parsed.data.lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
    })),
  });
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'invoice_create_failed',
          message: safeErrorMessage(
            error,
            'Could not create this invoice. Please try again, or contact support if this continues.',
            'invoices.create',
          ),
        },
      },
      { status: 400 },
    );
  }

  const { data: invoice, error: fetchError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .single();
  if (fetchError) {
    return NextResponse.json(
      {
        error: {
          code: 'invoice_fetch_failed',
          message: safeErrorMessage(fetchError, 'Invoice was created, but could not be loaded. Please refresh.', 'invoices.create.fetch'),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ invoice: mapInvoiceRow(invoice) }, { status: 201 });
}
