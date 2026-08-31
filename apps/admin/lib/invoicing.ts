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
export type InvoiceDisplayStatus = 'Draft' | 'Issued' | 'Partially paid' | 'Paid' | 'Overdue';

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
}): InvoiceDisplayStatus {
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
