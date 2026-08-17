import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  PaymentReportReviewList,
  type PaymentReportWithNames,
} from '@/components/payments/PaymentReportReviewList';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPaymentReportRow } from '@/lib/paymentReports';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

/**
 * GET /accounting/payment-reports -- WhatsApp V1 final pre-production pass, Phase 2 (WORKLOG.md
 * this date). Staff-facing review queue for tenant-self-reported payments. RLS
 * (payment_reports_select_staff_or_owner, migration 20260101000106) is the real scoping --
 * org+property-access, same floor as the rest of accounting. Confirm/reject buttons post through
 * PaymentReportReviewList to the caller's own-session-bound RPC wrapper routes, never
 * service-role, so an agent without accountant+ role gets a real 403 from the RPC itself.
 */
export default async function StaffPaymentReportsPage() {
  const reports = ADMIN_DEMO_MODE ? [] : await loadReports();

  return (
    <div className="space-y-5 animate-rise">
      <div>
        <Link
          href="/accounting"
          className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
        >
          ← Back to accounting
        </Link>
        <div className="mt-2">
          <PageHeader
            title="Payment reports"
            subtitle="Tenant-reported payments awaiting your confirmation. Confirming acknowledges the report -- it doesn't post to the ledger."
          />
        </div>
      </div>

      <PaymentReportReviewList reports={reports} />
    </div>
  );
}

async function loadReports(): Promise<PaymentReportWithNames[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('payment_reports')
    .select('*, tenants(full_name), properties(nickname)')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(`Failed to load payment reports: ${error.message}`);

  return (data ?? []).map((row) => ({
    ...mapPaymentReportRow(row),
    tenantName:
      (row as unknown as { tenants: { full_name: string } | null }).tenants?.full_name ?? null,
    propertyName:
      (row as unknown as { properties: { nickname: string } | null }).properties?.nickname ?? null,
  }));
}
