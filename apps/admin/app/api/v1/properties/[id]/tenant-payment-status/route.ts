import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabaseClient } from '@/lib/supabase/server';

type RouteParams = { params: Promise<{ id: string }> };

interface RentScheduleRow {
  id: string;
  amount: string;
  status: string;
  due_date: string;
  lease: {
    id: string;
    unit: { unit_label: string } | null;
    lease_tenants: { tenant: { id: string; full_name: string } | null }[];
  } | null;
}

/**
 * GET /api/v1/properties/:id/tenant-payment-status?month=YYYY-MM-01 -- UTILITIES_RATES_BUDGET_GAP_AUDIT.md
 * §6/§7 finding "reuse rent_schedules ... do not create a duplicate tenant-payment-status table".
 * A plain RLS-scoped read (no RPC/SECURITY DEFINER needed -- this is the exact same
 * rent_schedules_select_org_member-gated data /accounting/rent-due already reads, just joined out
 * to tenant/unit names and pre-computed per-row outstanding for a mobile list). The authoritative
 * status column is rent_schedules.status directly -- never inferred from payment_reports.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
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

  const month = request.nextUrl.searchParams.get('month');
  if (!month) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'A ?month=YYYY-MM-01 query parameter is required.' } },
      { status: 400 },
    );
  }
  const monthStart = new Date(`${month}T00:00:00Z`);
  if (Number.isNaN(monthStart.getTime())) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'month must be a valid YYYY-MM-01 date.' } },
      { status: 400 },
    );
  }
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));

  const { data: units, error: unitsError } = await supabase
    .from('units')
    .select('id')
    .eq('property_id', id);
  if (unitsError) {
    return NextResponse.json(
      { error: { code: 'tenant_payment_status_failed', message: "Could not load this property's units." } },
      { status: 500 },
    );
  }
  const unitIds = (units ?? []).map((u) => u.id);
  if (unitIds.length === 0) {
    return NextResponse.json({ tenantPaymentStatus: [] });
  }

  const { data, error } = await supabase
    .from('rent_schedules')
    .select(
      `id, amount, status, due_date,
       lease:leases!inner(id, unit:units!inner(unit_label), lease_tenants(tenant:tenants(id, full_name)))`,
    )
    .in('lease.unit_id', unitIds)
    .gte('due_date', monthStart.toISOString().slice(0, 10))
    .lt('due_date', monthEnd.toISOString().slice(0, 10));

  if (error) {
    return NextResponse.json(
      {
        error: {
          code: 'tenant_payment_status_failed',
          message: 'Could not load tenant payment status.',
        },
      },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as unknown as RentScheduleRow[];
  const leaseIds = [...new Set(rows.map((r) => r.lease?.id).filter((v): v is string => !!v))];

  const { data: paidRows } = leaseIds.length
    ? await supabase
        .from('invoice_payments')
        .select('amount, invoice:invoices!inner(lease_id, period)')
        .in('invoice.lease_id', leaseIds)
        .is('reversed_at', null)
    : { data: [] };

  const paidByLeasePeriod = new Map<string, number>();
  for (const p of (paidRows ?? []) as unknown as { amount: string; invoice: { lease_id: string; period: string } }[]) {
    const key = `${p.invoice.lease_id}:${p.invoice.period}`;
    paidByLeasePeriod.set(key, (paidByLeasePeriod.get(key) ?? 0) + Number(p.amount));
  }

  const result = rows.map((row) => {
    const tenantName = row.lease?.lease_tenants?.[0]?.tenant?.full_name ?? 'Unknown tenant';
    const unitLabel = row.lease?.unit?.unit_label ?? '';
    const expected = Number(row.amount);
    const key = `${row.lease?.id}:${row.due_date}`;
    const confirmedPaid = Math.min(paidByLeasePeriod.get(key) ?? 0, expected);
    return {
      rentScheduleId: row.id,
      tenantName,
      unitLabel,
      expectedRent: expected,
      confirmedPaid,
      outstanding: Math.max(expected - confirmedPaid, 0),
      status: row.status,
      dueDate: row.due_date,
    };
  });

  return NextResponse.json({ tenantPaymentStatus: result });
}
