import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceRoleClient } from './supabase/server';

// Landlord rent-invoicing pass (WORKLOG.md this date): the one piece of real display-status logic
// behind the /accounting/invoices page, pulled out as a pure function (same "extract the pure
// logic, test it directly" convention as lib/dashboardKpis.ts's computeDashboardKpis()) rather
// than left inline in the page component where it could only be exercised through a full
// Supabase-backed render.
//
// Must reconcile with rent_schedules' own arrears status (task spec: "never have rent-schedule say
// R4,000 outstanding while invoice says R0") -- balance is the single source of truth for
// paid/unpaid, schedule status only breaks the tie between "unpaid, not yet overdue" (Issued) and
// "unpaid, overdue" (Overdue).
export type InvoiceDisplayStatus = 'Draft' | 'Issued' | 'Partially paid' | 'Paid' | 'Overdue' | 'Void';

export function computeInvoiceDisplayStatus(input: {
  invoiceStatus: 'draft' | 'issued' | 'paid';
  balance: number;
  paid: number;
  scheduleStatus: string | undefined;
  /** Overnight V1 completion pass, Part B: manual invoices have no rent_schedule, so scheduleStatus
   * is always undefined for them -- overdue is derived from the invoice's own due date (period)
   * instead. Rent-schedule invoices keep using scheduleStatus exactly as before (this is only
   * consulted when scheduleStatus is absent, so existing call sites are unaffected). */
  dueDate?: string;
  today?: Date;
  /** Unified invoice-payment ledger (migration 20260101000158): a void invoice is never "Paid" or
   * "Overdue" -- it is excluded from outstanding-balance totals entirely, checked first. */
  voidedAt?: string | null;
}): InvoiceDisplayStatus {
  if (input.voidedAt) return 'Void';
  if (input.invoiceStatus === 'draft') return 'Draft';
  if (input.balance <= 0) return 'Paid';
  if (input.scheduleStatus === 'overdue') return 'Overdue';
  if (input.scheduleStatus === undefined && input.dueDate) {
    const today = input.today ?? new Date();
    if (new Date(input.dueDate).getTime() < today.getTime()) return 'Overdue';
  }
  if (input.paid > 0) return 'Partially paid';
  return 'Issued';
}

export interface InvoiceWithBalance {
  id: string;
  invoiceNumber: string;
  tenantId: string;
  tenantName: string;
  propertyId: string;
  propertyNickname: string;
  unitId: string;
  unitLabel: string;
  description: string;
  period: string;
  issuedAt: string | null;
  amount: number;
  paid: number;
  balance: number;
  displayStatus: InvoiceDisplayStatus;
  emailedAt: string | null;
  voidedAt: string | null;
  source: 'rent_schedule' | 'manual';
}

/**
 * The one query behind /accounting/invoices, the tenant detail page's Balance stat and Payments
 * tab, and (by extension) any future dashboard total -- Option A, unified invoice-payment ledger,
 * single-source-of-truth correction pass (migrations 158 + 159). paid_amount for EVERY invoice
 * (manual or rent-sourced) is SUM(invoice_payments.amount WHERE reversed_at IS NULL) -- full stop.
 * No other table independently contributes: confirm_bank_transaction_match() and
 * confirm_cash_receipt_deposit() (migration 159) now create their own invoice_payments allocation
 * row at match/deposit time, so a rent invoice's bank- or cash-derived payments are already IN this
 * one ledger, not a second total computed alongside it. This is the exact same formula
 * recompute_rent_schedule_status() uses server-side, so this can never disagree with Rent Due or
 * the property Accounting tab. A voided invoice is always excluded from balance (never negative,
 * never counted as outstanding) but remains in the returned list -- callers decide whether to
 * display it.
 */
export async function loadInvoicesWithBalances(
  supabase: SupabaseClient,
  filters?: { tenantId?: string },
): Promise<InvoiceWithBalance[]> {
  let query = supabase
    .from('invoices')
    .select(
      '*, leases(unit_id, units(unit_label, property_id, properties(nickname))), tenants(full_name)',
    )
    .order('period', { ascending: false });
  if (filters?.tenantId) query = query.eq('tenant_id', filters.tenantId);

  const { data: invoiceRows, error } = await query;
  if (error) throw new Error(`Failed to load invoices: ${error.message}`);
  if (!invoiceRows || invoiceRows.length === 0) return [];

  const invoiceIds = invoiceRows.map((r) => r.id as string);
  const { data: allPayments } = await supabase
    .from('invoice_payments')
    .select('invoice_id, amount')
    .in('invoice_id', invoiceIds)
    .is('reversed_at', null);
  const paidByInvoiceId = new Map<string, number>();
  for (const p of allPayments ?? []) {
    paidByInvoiceId.set(p.invoice_id, (paidByInvoiceId.get(p.invoice_id) ?? 0) + Number(p.amount));
  }

  // Schedule status is still needed for display purposes (the Overdue/Issued tie-break below), but
  // NOT for paid/balance -- that comes from invoice_payments alone.
  const leaseIds = [...new Set(invoiceRows.map((r) => r.lease_id))];
  const { data: schedules } = await supabase
    .from('rent_schedules')
    .select('id, lease_id, due_date, status')
    .in('lease_id', leaseIds);

  // Authoritative link (invoice_rent_schedule(), migration 20260101000038): the invoice's own
  // (lease_id, period) is set from the source rent_schedule's (lease_id, due_date) at issuance
  // time, exact match -- there is no separate FK, this is how the two rows are actually related.
  const scheduleByLeasePeriod = new Map(
    (schedules ?? []).map((s) => [`${s.lease_id}:${s.due_date}`, s]),
  );

  return invoiceRows.map((row) => {
    const lease = row.leases as unknown as {
      unit_id: string;
      units: { unit_label: string; property_id: string; properties: { nickname: string } | null } | null;
    } | null;
    const unit = lease?.units;
    const property = unit?.properties;
    const tenant = row.tenants as unknown as { full_name: string } | null;

    const isManual = row.source === 'manual';
    const schedule = isManual ? undefined : scheduleByLeasePeriod.get(`${row.lease_id}:${row.period}`);
    // ONE source, for every invoice regardless of source -- confirm_bank_transaction_match() and
    // confirm_cash_receipt_deposit() (migration 159) now create their own invoice_payments
    // allocation row, so a rent invoice's bank/cash-derived payments are already counted here.
    const paid = paidByInvoiceId.get(row.id) ?? 0;
    const amount = Number(row.amount);
    const isVoid = Boolean(row.voided_at);
    const balance = isVoid ? 0 : Math.max(0, amount - paid);

    const displayStatus = computeInvoiceDisplayStatus({
      invoiceStatus: row.status as 'draft' | 'issued' | 'paid',
      balance,
      paid,
      scheduleStatus: schedule?.status,
      dueDate: isManual ? row.period : undefined,
      voidedAt: row.voided_at,
    });

    const periodDate = new Date(row.period);
    const description = isManual
      ? (row.description ?? 'Manual invoice')
      : `${periodDate.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })} Rent`;

    return {
      id: row.id,
      invoiceNumber: row.invoice_number,
      tenantId: row.tenant_id,
      tenantName: tenant?.full_name ?? 'Unknown tenant',
      propertyId: unit?.property_id ?? '',
      propertyNickname: property?.nickname ?? '—',
      unitId: lease?.unit_id ?? '',
      unitLabel: unit?.unit_label ?? '—',
      description,
      period: row.period,
      issuedAt: row.issued_at,
      amount,
      paid,
      balance,
      displayStatus,
      emailedAt: row.emailed_at,
      voidedAt: row.voided_at,
      source: row.source,
    };
  });
}

export interface TenantPaymentLedgerRow {
  id: string;
  paidAt: string;
  invoiceId: string;
  invoiceNumber: string;
  description: string;
  method: string | null;
  reference: string | null;
  amount: number;
  recordedByName: string | null;
  reversedAt: string | null;
  reversedByName: string | null;
  reversalReason: string | null;
}

/**
 * The tenant detail page's Payments tab (unified invoice-payment ledger, migration
 * 20260101000158): a real invoice_payments-based ledger covering BOTH manual and rent-sourced
 * invoices -- never rent_schedules rendered as if they were payments, which is what this page did
 * before this pass. "Recorded by"/"Reversed by" need other users' display names, which the
 * profiles table's own RLS (own-row SELECT only) blocks for anyone but the caller themselves -- the
 * batch lookup goes through the service-role client, same fix already applied in
 * downgradeImpact.ts's staff listing.
 */
export async function loadTenantPaymentLedger(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TenantPaymentLedgerRow[]> {
  const { data: rows, error } = await supabase
    .from('invoice_payments')
    .select('*, invoices(invoice_number, description, source, period)')
    .eq('tenant_id', tenantId)
    .order('paid_at', { ascending: false });
  if (error) throw new Error(`Failed to load tenant payments: ${error.message}`);
  if (!rows || rows.length === 0) return [];

  const userIds = [
    ...new Set(
      [...rows.map((r) => r.recorded_by), ...rows.map((r) => r.reversed_by_user_id)].filter(
        (v): v is string => Boolean(v),
      ),
    ),
  ];
  const serviceClient = getServiceRoleClient();
  const { data: profiles } =
    userIds.length > 0
      ? await serviceClient.from('profiles').select('id, display_name').in('id', userIds)
      : { data: [] as { id: string; display_name: string | null }[] };
  const nameByUserId = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  return rows.map((row) => {
    const invoice = row.invoices as unknown as {
      invoice_number: string;
      description: string | null;
      source: string;
      period: string;
    } | null;
    const description = invoice
      ? invoice.source === 'manual'
        ? (invoice.description ?? 'Manual invoice')
        : `${new Date(invoice.period).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })} Rent`
      : 'Unknown invoice';

    return {
      id: row.id,
      paidAt: row.paid_at,
      invoiceId: row.invoice_id,
      invoiceNumber: invoice?.invoice_number ?? '—',
      description,
      method: row.method,
      reference: row.reference,
      amount: Number(row.amount),
      recordedByName: row.recorded_by ? (nameByUserId.get(row.recorded_by) ?? null) : null,
      reversedAt: row.reversed_at,
      reversedByName: row.reversed_by_user_id ? (nameByUserId.get(row.reversed_by_user_id) ?? null) : null,
      reversalReason: row.reversal_reason,
    };
  });
}
