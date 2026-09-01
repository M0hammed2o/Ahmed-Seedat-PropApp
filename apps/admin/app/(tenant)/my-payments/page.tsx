import Link from 'next/link';
import type { PaymentReport } from '@propvault/types';
import { PAYMENT_REPORT_STATUS_PRESENTATION } from '@propvault/ui';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { resolveTenantSession, getTenancyLeaseIds } from '@/lib/tenantSession';
import { mapPaymentReportRow } from '@/lib/paymentReports';
import {
  loadInvoicesWithBalances,
  loadTenantPaymentLedger,
  type InvoiceWithBalance,
  type TenantPaymentLedgerRow,
} from '@/lib/invoicing';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_INVOICES: InvoiceWithBalance[] = [
  {
    id: 'demo-tenant-invoice-1',
    invoiceNumber: 'INV-000201',
    tenantId: 'demo-tenant-1',
    tenantName: 'Demo Tenant',
    propertyId: 'demo-property-1',
    propertyNickname: 'Demo Property',
    unitId: 'demo-tenant-unit-1',
    unitLabel: 'Unit 1',
    description: 'August 2026 Rent',
    period: '2026-08-01',
    issuedAt: '2026-08-01T00:00:00Z',
    amount: 10650,
    paid: 0,
    balance: 10650,
    displayStatus: 'Issued',
    emailedAt: null,
    voidedAt: null,
    source: 'rent_schedule',
  },
];

const DEMO_PAYMENTS: TenantPaymentLedgerRow[] = [
  {
    id: 'demo-tenant-payment-1',
    paidAt: '2026-07-01',
    invoiceId: 'demo-tenant-invoice-2',
    invoiceNumber: 'INV-000188',
    description: 'July 2026 Rent',
    method: 'eft',
    reference: 'REF778812',
    amount: 10650,
    recordedByName: null,
    reversedAt: null,
    reversedByName: null,
    reversalReason: null,
  },
];

/**
 * GET /my-payments — tenant portal. Unified invoice-payment ledger (migrations 20260101000158/
 * 159/161, tenant-portal release-gate pass): Outstanding balance and payment history now come
 * from the SAME authoritative source the landlord side uses -- loadInvoicesWithBalances()
 * (paid_amount = SUM(invoice_payments.amount WHERE reversed_at IS NULL), balance = amount - paid,
 * void excluded) and loadTenantPaymentLedger() -- never rent_schedules, which this page previously
 * (incorrectly) used to compute "outstanding balance" independently of the real payment ledger.
 * "Payments you've reported" (payment_reports, a tenant self-report awaiting staff confirmation)
 * is a genuinely separate feature and is kept as-is.
 */
export default async function MyPaymentsPage() {
  const invoices = ADMIN_DEMO_MODE ? DEMO_INVOICES : await loadTenantInvoices();
  const payments = ADMIN_DEMO_MODE ? DEMO_PAYMENTS : await loadTenantPayments();
  const paymentReports = ADMIN_DEMO_MODE ? [] : await loadPaymentReports();

  const outstanding = invoices.reduce((sum, inv) => sum + inv.balance, 0);

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader title="My Payments" subtitle="Your invoices, outstanding balance, and payment history." />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-xs">
          <AdminMetricCard label="Outstanding balance" value={`R${outstanding.toLocaleString('en-ZA')}`} />
        </div>
        <Link href="/my-payments/report">
          <Button variant="primary">Report a payment</Button>
        </Link>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Payments you've reported
        </h2>
        {paymentReports.length === 0 ? (
          <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
            You haven't reported any payments yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-light-border bg-light-surfaceStrong dark:border-dark-border dark:bg-dark-surfaceStrong">
                <tr>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                    Date
                  </th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                    Amount
                  </th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                    Method
                  </th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {paymentReports.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-light-border last:border-0 dark:border-dark-border"
                  >
                    <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                      {r.paymentDate}
                    </td>
                    <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">
                      R{r.amount.toLocaleString('en-ZA')}
                    </td>
                    <td className="px-4 py-3 capitalize text-light-textPrimary dark:text-dark-textPrimary">
                      {r.paymentMethod}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge presentation={PAYMENT_REPORT_STATUS_PRESENTATION[r.status]} />
                      {r.status === 'rejected' && r.rejectionReason ? (
                        <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
                          {r.rejectionReason}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Invoices
        </h2>
        {invoices.length === 0 ? (
          <EmptyState icon={<span className="text-lg">🧾</span>} title="No invoices yet" />
        ) : (
          <div className="overflow-x-auto rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-light-border bg-light-surfaceStrong dark:border-dark-border dark:bg-dark-surfaceStrong">
                <tr>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Invoice #</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Description</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Due date</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Amount</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Paid</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Balance</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Status</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">PDF</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-light-border last:border-0 dark:border-dark-border">
                    <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">{inv.description}</td>
                    <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">{inv.period}</td>
                    <td className="px-4 py-3 tabular text-light-textPrimary dark:text-dark-textPrimary">R{inv.amount.toLocaleString('en-ZA')}</td>
                    <td className="px-4 py-3 tabular text-light-textPrimary dark:text-dark-textPrimary">R{inv.paid.toLocaleString('en-ZA')}</td>
                    <td className="px-4 py-3 tabular text-light-textPrimary dark:text-dark-textPrimary">R{inv.balance.toLocaleString('en-ZA')}</td>
                    <td className="px-4 py-3">{inv.displayStatus}</td>
                    <td className="px-4 py-3">
                      <a
                        href={`/api/v1/invoices/${inv.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-light-accent hover:underline dark:text-dark-accent"
                      >
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Payment history
        </h2>
        {payments.length === 0 ? (
          <EmptyState icon={<span className="text-lg">💵</span>} title="No payments recorded yet" />
        ) : (
          <div className="overflow-x-auto rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-light-border bg-light-surfaceStrong dark:border-dark-border dark:bg-dark-surfaceStrong">
                <tr>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Date</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Invoice #</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Description</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Amount</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Method</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Reference</th>
                  <th className="px-4 py-3 font-medium text-light-textSecondary dark:text-dark-textSecondary">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-light-border last:border-0 dark:border-dark-border">
                    <td className={`px-4 py-3 ${p.reversedAt ? 'text-light-textMuted line-through dark:text-dark-textMuted' : 'text-light-textPrimary dark:text-dark-textPrimary'}`}>
                      {p.paidAt}
                    </td>
                    <td className={`px-4 py-3 ${p.reversedAt ? 'text-light-textMuted line-through dark:text-dark-textMuted' : 'text-light-textPrimary dark:text-dark-textPrimary'}`}>
                      {p.invoiceNumber}
                    </td>
                    <td className={`px-4 py-3 ${p.reversedAt ? 'text-light-textMuted line-through dark:text-dark-textMuted' : 'text-light-textPrimary dark:text-dark-textPrimary'}`}>
                      {p.description}
                    </td>
                    <td className={`px-4 py-3 tabular ${p.reversedAt ? 'text-light-textMuted line-through dark:text-dark-textMuted' : 'text-light-textPrimary dark:text-dark-textPrimary'}`}>
                      R{p.amount.toLocaleString('en-ZA')}
                    </td>
                    <td className="px-4 py-3 capitalize text-light-textPrimary dark:text-dark-textPrimary">{p.method ?? '—'}</td>
                    <td className="px-4 py-3 text-light-textPrimary dark:text-dark-textPrimary">{p.reference ?? '—'}</td>
                    <td className="px-4 py-3">
                      {p.reversedAt ? (
                        <span className="text-xs text-light-statusOverdue dark:text-dark-statusOverdue">Reversed</span>
                      ) : (
                        <span className="text-xs text-light-statusPaid dark:text-dark-statusPaid">Paid</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

async function loadTenantInvoices(): Promise<InvoiceWithBalance[]> {
  const supabase = await getServerSupabaseClient();
  const session = await resolveTenantSession();
  if (!session) return [];
  const invoices = await loadInvoicesWithBalances(supabase, { tenantId: session.tenantId });
  // Draft invoices are never shown to a tenant -- only issued (or void) ones.
  return invoices.filter((inv) => inv.displayStatus !== 'Draft');
}

async function loadTenantPayments(): Promise<TenantPaymentLedgerRow[]> {
  const supabase = await getServerSupabaseClient();
  const session = await resolveTenantSession();
  if (!session) return [];
  return loadTenantPaymentLedger(supabase, session.tenantId);
}

async function loadPaymentReports(): Promise<PaymentReport[]> {
  const supabase = await getServerSupabaseClient();
  const session = await resolveTenantSession();
  if (!session) return [];

  // Same active-tenancy lease scoping as loadTenantInvoices()/loadTenantPayments() above -- never
  // another tenancy's reports the same Auth user also happens to hold, even though
  // payment_reports_select_tenant_self (migration 20260101000106) would also permit it.
  const leaseIds = await getTenancyLeaseIds(supabase, session.tenantId);
  if (leaseIds.length === 0) return [];

  const { data, error } = await supabase
    .from('payment_reports')
    .select('*')
    .in('lease_id', leaseIds)
    .order('payment_date', { ascending: false });
  if (error) throw new Error(`Failed to load payment reports: ${error.message}`);
  return (data ?? []).map(mapPaymentReportRow);
}
