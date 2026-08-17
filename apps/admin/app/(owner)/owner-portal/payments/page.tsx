import { PageHeader } from '@/components/ui/PageHeader';
import {
  PaymentReportReviewList,
  type PaymentReportWithNames,
} from '@/components/payments/PaymentReportReviewList';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapPaymentReportRow } from '@/lib/paymentReports';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

/**
 * GET /owner-portal/payments -- WhatsApp V1 final pre-production pass, Phase 2 (WORKLOG.md this
 * date). Same review component as the staff-facing page, same RLS
 * (payment_reports_select_staff_or_owner's "OR a direct property owner" branch) -- an owner sees
 * and can confirm/reject only reports against properties they actually co-own, never another
 * owner's unrelated property even within the same org.
 */
export default async function OwnerPaymentReportsPage() {
  const reports = ADMIN_DEMO_MODE ? [] : await loadReports();

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Payments"
        subtitle="Payments your tenants have reported, awaiting confirmation."
      />
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
