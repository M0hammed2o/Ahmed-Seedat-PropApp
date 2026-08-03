import type { OwnerStatement } from '@propvault/types';
import { OwnerStatementsTable, type OwnerStatementWithOwnerName } from '@/components/tables/OwnerStatementsTable';
import { AdminMetricCard } from '@/components/ui/AdminMetricCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { GenerateOwnerStatementsButton } from '@/components/accounting/GenerateOwnerStatementsButton';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapOwnerStatementRow } from '@/lib/accounting';
import { resolvePortalSession, findActiveMembership, canPostAccountingRecords } from '@/lib/orgSession';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

const DEMO_STATEMENTS: OwnerStatementWithOwnerName[] = [
  {
    id: 'demo-owner-statement-1',
    orgId: 'demo-org-1',
    ownerId: 'demo-owner-1',
    ownerName: 'Demo Owner',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    rentCollected: 18500,
    expensesTotal: 1200,
    managementFee: 1850,
    netPayable: 15450,
    status: 'issued',
    payoutMatchedTransactionId: null,
    pdfDocumentId: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
];

/**
 * GET /accounting/owner-statements (TASKS.md M14 part 3, API_SPEC.md §6) -- generated statements
 * only, never hand-created (ACCOUNTING.md §5). Same direct-RLS-read + demo-mode pattern as every
 * other Accounting list page this milestone.
 */
export default async function OwnerStatementsPage() {
  const statements = ADMIN_DEMO_MODE ? DEMO_STATEMENTS : await loadOwnerStatements();
  const orgId = ADMIN_DEMO_MODE ? 'demo-org-1' : await resolveOrgId();
  const canPost = ADMIN_DEMO_MODE ? true : await resolveCanPost();

  const draft = statements.filter((s) => s.status === 'draft').length;
  const issued = statements.filter((s) => s.status === 'issued').length;
  const paid = statements.filter((s) => s.status === 'paid').length;

  const generateAction = orgId && canPost ? <GenerateOwnerStatementsButton orgId={orgId} /> : null;

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Owner Statements"
        subtitle="Generated from the ledger, never hand-entered — one statement per owner per period."
        actions={statements.length > 0 ? (generateAction ?? undefined) : undefined}
      />

      <div className="grid grid-cols-3 gap-4">
        <AdminMetricCard label="Draft" value={draft} />
        <AdminMetricCard label="Issued" value={issued} />
        <AdminMetricCard label="Paid" value={paid} />
      </div>

      <OwnerStatementsTable data={statements} emptyAction={generateAction ?? undefined} />
    </div>
  );
}

async function loadOwnerStatements(): Promise<OwnerStatementWithOwnerName[]> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('owner_statements')
    .select('*, owners(name)')
    .order('period_start', { ascending: false });
  if (error) throw new Error(`Failed to load owner statements: ${error.message}`);
  return (data ?? []).map((row) => {
    const statement: OwnerStatement = mapOwnerStatementRow(row);
    const ownerName = (row as { owners?: { name?: string } | null }).owners?.name ?? 'Unknown owner';
    return { ...statement, ownerName };
  });
}

async function resolveOrgId(): Promise<string | undefined> {
  const session = await resolvePortalSession();
  return session?.organizations.find((m) => m.status === 'active')?.orgId;
}

async function resolveCanPost(): Promise<boolean> {
  const session = await resolvePortalSession();
  if (!session) return false;
  const activeOrg = session.organizations.find((m) => m.status === 'active');
  if (!activeOrg) return false;
  const membership = findActiveMembership(session, activeOrg.orgId);
  return Boolean(membership && canPostAccountingRecords(membership.role));
}
