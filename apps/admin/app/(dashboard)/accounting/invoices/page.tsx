import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { InvoicesClient } from '@/components/accounting/InvoicesClient';
import type { InvoiceRow } from '@/components/accounting/InvoicesTable';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import {
  resolvePortalSession,
  findActiveMembership,
  canPostAccountingRecords,
} from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';
import { computeInvoiceDisplayStatus } from '@/lib/invoicing';
import { formatSouthAfricanNumber } from '@propvault/utils';

const DEMO_INVOICES: InvoiceRow[] = [
  {
    id: 'demo-invoice-1',
    invoiceNumber: 'INV-000123',
    tenantId: 'demo-tenant-1',
    tenantName: 'Naledi Khumalo',
    propertyId: 'demo-property-1',
    propertyNickname: 'Sea Point Apartment',
    unitId: 'demo-unit-1',
    unitLabel: 'Unit 1',
    description: 'September 2026 Rent',
    period: '2026-09-01',
    issuedAt: '2026-08-25T00:00:00Z',
    amount: 12500,
    paid: 8000,
    balance: 4500,
    displayStatus: 'Partially paid',
    emailedAt: null,
  },
];

/**
 * GET /accounting/invoices -- the tenant rent-invoice listing (landlord -> tenant), distinct from
 * Organisation/Billing's SaaS subscription_invoices (Proplyst -> landlord), which never appear
 * here. `public.invoices` (migration 20260101000037/38) is the authoritative rent-charge invoice
 * entity -- this page presents it, it never creates a second, competing financial source of truth.
 * Paid/balance/display-status are computed from the SAME rent_schedules + matched
 * bank_transactions/cash_receipts totals the Rent Due page and property Accounting tab already
 * use, so this page can never show a different arrears figure than they do.
 */
export default async function InvoicesPage() {
  const invoices: InvoiceRow[] = ADMIN_DEMO_MODE ? DEMO_INVOICES : await loadInvoices();
  const canSend = ADMIN_DEMO_MODE ? true : await resolveCanPost();

  const totalOutstanding = invoices.reduce((sum, i) => sum + i.balance, 0);
  const overdueCount = invoices.filter((i) => i.displayStatus === 'Overdue').length;
  const paidCount = invoices.filter((i) => i.displayStatus === 'Paid').length;

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Invoices"
        subtitle="Rent invoices issued to your tenants -- separate from your own Proplyst subscription invoices, which live under Organisation -> Billing."
        actions={
          canSend ? (
            <Link href="/accounting/invoices/new">
              <Button variant="primary" size="sm">
                + Create invoice
              </Button>
            </Link>
          ) : undefined
        }
      />

      {invoices.length > 0 ? (
        <div className="grid grid-cols-3 gap-4">
          <AdminMetricCard label="Total invoices" value={invoices.length} />
          <AdminMetricCard label="Overdue" value={overdueCount} />
          <AdminMetricCard label="Paid" value={paidCount} />
        </div>
      ) : null}

      {invoices.length > 0 ? (
        <p className="text-[12px] text-muted-foreground">
          R{formatSouthAfricanNumber(totalOutstanding)} outstanding across every invoice below.
        </p>
      ) : null}

      <InvoicesClient invoices={invoices} canSend={canSend} />
    </div>
  );
}

async function resolveCanPost(): Promise<boolean> {
  const session = await resolvePortalSession();
  if (!session) return false;
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) return false;
  const membership = findActiveMembership(session, activeOrg.orgId);
  return Boolean(membership && canPostAccountingRecords(membership.role));
}

async function loadInvoices(): Promise<InvoiceRow[]> {
  const supabase = await getServerSupabaseClient();

  const { data: invoiceRows, error } = await supabase
    .from('invoices')
    .select(
      '*, leases(unit_id, units(unit_label, property_id, properties(nickname))), tenants(full_name)',
    )
    .order('period', { ascending: false });
  if (error) throw new Error(`Failed to load invoices: ${error.message}`);
  if (!invoiceRows || invoiceRows.length === 0) return [];

  const leaseIds = [...new Set(invoiceRows.map((r) => r.lease_id))];
  const { data: schedules } = await supabase
    .from('rent_schedules')
    .select('id, lease_id, due_date, status')
    .in('lease_id', leaseIds);

  // Overnight V1 completion pass, Part B: manual invoices (source='manual') have no rent_schedule
  // at all -- their "paid" total comes from invoice_payments instead, a deliberately separate
  // ledger from bank_transactions/cash_receipts (see migration 20260101000152's own comment).
  const manualInvoiceIds = invoiceRows.filter((r) => r.source === 'manual').map((r) => r.id);
  const { data: manualPayments } =
    manualInvoiceIds.length > 0
      ? await supabase.from('invoice_payments').select('invoice_id, amount').in('invoice_id', manualInvoiceIds)
      : { data: [] as { invoice_id: string; amount: number }[] };
  const paidByInvoiceId = new Map<string, number>();
  for (const p of manualPayments ?? []) {
    paidByInvoiceId.set(p.invoice_id, (paidByInvoiceId.get(p.invoice_id) ?? 0) + Number(p.amount));
  }

  // Authoritative link (invoice_rent_schedule(), migration 20260101000038): the invoice's own
  // (lease_id, period) is set from the source rent_schedule's (lease_id, due_date) at issuance
  // time, exact match -- there is no separate FK, this is how the two rows are actually related.
  const scheduleByLeasePeriod = new Map(
    (schedules ?? []).map((s) => [`${s.lease_id}:${s.due_date}`, s]),
  );
  const scheduleIds = (schedules ?? []).map((s) => s.id);

  const [{ data: matchedTxns }, { data: cashReceipts }] = await Promise.all([
    scheduleIds.length > 0
      ? supabase
          .from('bank_transactions')
          .select('amount, matched_rent_schedule_id')
          .eq('match_status', 'matched')
          .in('matched_rent_schedule_id', scheduleIds)
      : Promise.resolve({ data: [] as { amount: number; matched_rent_schedule_id: string }[] }),
    scheduleIds.length > 0
      ? supabase
          .from('cash_receipts')
          .select('amount, rent_schedule_id')
          .not('deposited_at', 'is', null)
          .in('rent_schedule_id', scheduleIds)
      : Promise.resolve({ data: [] as { amount: number; rent_schedule_id: string }[] }),
  ]);

  const paidByScheduleId = new Map<string, number>();
  for (const t of matchedTxns ?? []) {
    paidByScheduleId.set(
      t.matched_rent_schedule_id,
      (paidByScheduleId.get(t.matched_rent_schedule_id) ?? 0) + Number(t.amount),
    );
  }
  for (const r of cashReceipts ?? []) {
    paidByScheduleId.set(
      r.rent_schedule_id,
      (paidByScheduleId.get(r.rent_schedule_id) ?? 0) + Number(r.amount),
    );
  }

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
    const paid = isManual ? (paidByInvoiceId.get(row.id) ?? 0) : schedule ? (paidByScheduleId.get(schedule.id) ?? 0) : 0;
    const amount = Number(row.amount);
    const balance = Math.max(0, amount - paid);

    const displayStatus = computeInvoiceDisplayStatus({
      invoiceStatus: row.status as 'draft' | 'issued' | 'paid',
      balance,
      paid,
      scheduleStatus: schedule?.status,
      dueDate: isManual ? row.period : undefined,
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
    };
  });
}
