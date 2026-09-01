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
import { loadInvoicesWithBalances } from '@/lib/invoicing';
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
    voidedAt: null,
    source: 'rent_schedule',
  },
];

/**
 * GET /accounting/invoices -- the tenant rent-invoice listing (landlord -> tenant), distinct from
 * Organisation/Billing's SaaS subscription_invoices (Proplyst -> landlord), which never appear
 * here. `public.invoices` (migration 20260101000037/38) is the authoritative rent-charge invoice
 * entity -- this page presents it, it never creates a second, competing financial source of truth.
 * Paid/balance/display-status come from lib/invoicing.ts's loadInvoicesWithBalances() -- the one
 * shared computation (unified invoice-payment ledger, migration 20260101000158) also used by the
 * tenant detail page's Balance stat and Payments tab, so this page, Rent Due, property Accounting,
 * and the tenant portal can never disagree on a single invoice's outstanding balance.
 */
export default async function InvoicesPage() {
  const invoices: InvoiceRow[] = ADMIN_DEMO_MODE
    ? DEMO_INVOICES
    : await loadInvoicesWithBalances(await getServerSupabaseClient());
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
