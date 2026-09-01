import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Mail, Phone, FileText, ShieldCheck } from 'lucide-react';
import type {
  Tenant,
  TenantInvitation,
  Lease,
  MaintenanceTicket,
  DocumentRecord,
} from '@propvault/types';
import {
  TENANT_STATUS_PRESENTATION,
  LEASE_STATUS_PRESENTATION,
  MAINTENANCE_STATUS_PRESENTATION,
} from '@propvault/ui';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapTenantRow, mapLeaseRow, pickCurrentLease } from '@/lib/leasing';
import { mapMaintenanceTicketRow } from '@/lib/operations';
import { mapDocumentRow } from '@/lib/documents';
import { mapTenantInvitationRow } from '@/lib/tenantInvitations';
import {
  loadInvoicesWithBalances,
  loadTenantPaymentLedger,
  type InvoiceWithBalance,
  type TenantPaymentLedgerRow,
} from '@/lib/invoicing';
import {
  deriveTenantPortalStatus,
  PORTAL_STATUS_TONE,
  type TenantPortalStatusResult,
} from '@/lib/tenantPortalStatus';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { SimpleTabs } from '@/components/ui/SimpleTabs';
import { TenantInvitationPanel } from '@/components/tenants/TenantInvitationPanel';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

function currency(n: number): string {
  return `R${Math.round(n).toLocaleString('en-ZA')}`;
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

type RouteParams = { params: Promise<{ id: string }> };

interface LeaseContext {
  lease: Lease;
  unitId: string | null;
  unitLabel: string | null;
  propertyId: string | null;
  propertyNickname: string | null;
}

const DEMO_TENANT: Tenant = {
  id: 'demo-tenant-1',
  orgId: 'demo-org-1',
  userId: null,
  fullName: 'Naledi Khumalo',
  email: 'naledi@example.com',
  phone: '+27 82 555 0134',
  idNumberRef: null,
  status: 'active',
  emergencyContactName: null,
  emergencyContactPhone: null,
  emergencyContactRelationship: null,
  createdAt: '2026-06-05T00:00:00Z',
  updatedAt: '2026-06-05T00:00:00Z',
};

// Empty on purpose -- the demo click-through (DEMO_PRESENTATION_SCRIPT.md) starts from "no
// invitation sent yet" so clicking "Send invitation" has something to actually demonstrate.
const DEMO_INVITATIONS: TenantInvitation[] = [];

const DEMO_LEASE_CONTEXT: LeaseContext = {
  lease: {
    id: 'demo-lease-1',
    orgId: 'demo-org-1',
    unitId: 'demo-unit-1',
    startDate: '2025-09-01',
    endDate: '2026-08-31',
    rentAmount: 12500,
    rentFrequency: 'monthly',
    depositAmount: 25000,
    status: 'active',
    source: 'manual',
    sourceDocumentId: null,
    sourceApplicationId: null,
    createdAt: '2025-08-24T00:00:00Z',
    updatedAt: '2025-08-24T00:00:00Z',
  },
  unitId: 'demo-unit-1',
  unitLabel: 'Unit 1',
  propertyId: 'demo-property-1',
  propertyNickname: 'Sea Point Apartment',
};

const DEMO_TENANCY_HISTORY: LeaseContext[] = [];

const DEMO_DOCUMENTS: DocumentRecord[] = [];

const DEMO_INVOICES: InvoiceWithBalance[] = [
  {
    id: 'demo-invoice-aug',
    invoiceNumber: 'INV-000201',
    tenantId: 'demo-tenant-1',
    tenantName: 'Naledi Khumalo',
    propertyId: 'demo-property-1',
    propertyNickname: 'Sea Point Apartment',
    unitId: 'demo-unit-1',
    unitLabel: 'Unit 1',
    description: 'August 2026 Rent',
    period: '2026-08-01',
    issuedAt: '2026-08-01T00:00:00Z',
    amount: 12500,
    paid: 0,
    balance: 12500,
    displayStatus: 'Overdue',
    emailedAt: null,
    voidedAt: null,
    source: 'rent_schedule',
  },
  {
    id: 'demo-invoice-jul',
    invoiceNumber: 'INV-000188',
    tenantId: 'demo-tenant-1',
    tenantName: 'Naledi Khumalo',
    propertyId: 'demo-property-1',
    propertyNickname: 'Sea Point Apartment',
    unitId: 'demo-unit-1',
    unitLabel: 'Unit 1',
    description: 'July 2026 Rent',
    period: '2026-07-01',
    issuedAt: '2026-07-01T00:00:00Z',
    amount: 12500,
    paid: 12500,
    balance: 0,
    displayStatus: 'Paid',
    emailedAt: null,
    voidedAt: null,
    source: 'rent_schedule',
  },
];

const DEMO_PAYMENTS: TenantPaymentLedgerRow[] = [
  {
    id: 'demo-payment-1',
    paidAt: '2026-07-01',
    invoiceId: 'demo-invoice-jul',
    invoiceNumber: 'INV-000188',
    description: 'July 2026 Rent',
    method: 'eft',
    reference: 'REF778812',
    amount: 12500,
    recordedByName: 'Demo Admin',
    reversedAt: null,
    reversedByName: null,
    reversalReason: null,
  },
];

// Same id/content as maintenance/[id]/page.tsx's own DEMO_TICKET -- so clicking through from here
// in the demo click-through lands on a real, matching detail page instead of a dead link.
const DEMO_MAINTENANCE_TICKETS: MaintenanceTicket[] = [
  {
    id: 'demo-ticket-1',
    orgId: 'demo-org-1',
    propertyId: 'demo-property-1',
    unitId: 'demo-unit-1',
    leaseId: 'demo-lease-1',
    tenantId: 'demo-tenant-1',
    submittedByUserId: 'demo-user-1',
    submittedByTenantId: null,
    summary: 'Leaking kitchen tap',
    description: 'Constant drip from the cold tap, worsening over the past week.',
    priority: 'medium',
    status: 'to_do',
    assignedVendorId: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    resolvedAt: null,
  },
];

export default async function TenantDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-tenant-1') notFound();
    return (
      <TenantDetailView
        tenant={DEMO_TENANT}
        canEdit
        canInvite
        invitations={DEMO_INVITATIONS}
        portalStatus={{ status: 'not_invited', label: 'Not invited' }}
        leaseContext={DEMO_LEASE_CONTEXT}
        tenancyHistory={DEMO_TENANCY_HISTORY}
        invoices={DEMO_INVOICES}
        payments={DEMO_PAYMENTS}
        maintenanceTickets={DEMO_MAINTENANCE_TICKETS}
        documents={DEMO_DOCUMENTS}
        demoMode
      />
    );
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.from('tenants').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load tenant: ${error.message}`);
  if (!data) notFound();
  const tenant = mapTenantRow(data);

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, tenant.orgId) : undefined;
  const canEdit = Boolean(membership && canWriteOrgRecords(membership.role));

  const canInvite = Boolean(membership && canWriteOrgRecords(membership.role));
  // tenant_invitations SELECT RLS is agent+ only (20260101000059) -- same floor as canInvite, so
  // this stays gated exactly like before; a viewer-role caller genuinely cannot see invitation
  // rows at the database level, so portalStatus for them can only ever resolve from
  // tenant.userId (Active vs Not invited), same limit the page already had pre-this-pass.
  let invitations: TenantInvitation[] = [];
  if (canInvite) {
    const { data: inviteRows, error: inviteError } = await supabase
      .from('tenant_invitations')
      .select('*')
      .eq('tenant_id', id)
      .order('created_at', { ascending: false });
    if (inviteError) throw new Error(`Failed to load tenant invitations: ${inviteError.message}`);
    invitations = (inviteRows ?? []).map(mapTenantInvitationRow);
  }
  const portalStatus = deriveTenantPortalStatus(
    tenant.userId,
    invitations.map((i) => ({
      acceptedAt: i.acceptedAt,
      revokedAt: i.revokedAt,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
    })),
  );

  const { current: leaseContext, history: tenancyHistory } = await loadTenancy(id);

  // Unified invoice-payment ledger (migration 20260101000158): Balance and the Payments tab both
  // come from this same pair of loaders lib/invoicing.ts also uses for /accounting/invoices --
  // never a second, independently-derived total, and never rent_schedules rendered as if it were a
  // payment ledger (rent_schedules is an obligation/arrears schedule, not a record of money moved).
  const [invoices, payments] = await Promise.all([
    loadInvoicesWithBalances(supabase, { tenantId: id }),
    loadTenantPaymentLedger(supabase, id),
  ]);

  const { data: mtRows, error: mtError } = await supabase
    .from('maintenance_tickets')
    .select('*')
    .eq('tenant_id', id)
    .order('created_at', { ascending: false })
    .limit(5);
  if (mtError) throw new Error(`Failed to load maintenance tickets: ${mtError.message}`);
  const maintenanceTickets = (mtRows ?? []).map(mapMaintenanceTicketRow);

  // Overnight V1 completion pass (WORKLOG.md this date), Part A gap 3: documents.tenant_id already
  // exists (migration 20260101000085) -- this panel was previously hardcoded to a "not linked yet"
  // placeholder with no real query at all. RLS-scoped like every other read on this page.
  const { data: docRows, error: docError } = await supabase
    .from('documents')
    .select('*')
    .eq('tenant_id', id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(10);
  if (docError) throw new Error(`Failed to load documents: ${docError.message}`);
  const documents = (docRows ?? []).map(mapDocumentRow);

  return (
    <TenantDetailView
      tenant={tenant}
      canEdit={canEdit}
      canInvite={canInvite}
      invitations={invitations}
      portalStatus={portalStatus}
      leaseContext={leaseContext}
      tenancyHistory={tenancyHistory}
      invoices={invoices}
      payments={payments}
      maintenanceTickets={maintenanceTickets}
      documents={documents}
    />
  );
}

// A tenant can have multiple leases over time (lease_tenants is a many-to-many join, TASKS.md M10)
// -- pickCurrentLease (lib/leasing.ts, shared with the tenant list page) picks the one lease the
// Lease/Payments tabs describe: the active one if there is one, otherwise the most recently
// started. Every OTHER lease this tenant has ever held is now surfaced as "Tenancy history"
// below, rather than silently discarded -- "do not overwrite historical tenancy information."
async function loadTenancy(
  tenantId: string,
): Promise<{ current: LeaseContext | null; history: LeaseContext[] }> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('lease_tenants')
    .select('leases(*, units(id, unit_label, properties(id, nickname)))')
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`Failed to load leases: ${error.message}`);

  type LeaseRow = Record<string, unknown> & {
    id: string;
    status: string;
    start_date: string;
    units: {
      id: string;
      unit_label: string;
      properties: { id: string; nickname: string } | null;
    } | null;
  };
  const rows = (data ?? []) as unknown as { leases: LeaseRow | null }[];
  const candidates = rows
    .map((r) => r.leases)
    .filter((l): l is LeaseRow => l !== null)
    .map((l) => ({ ...l, startDate: l.start_date }));

  const toContext = (row: (typeof candidates)[number]): LeaseContext => {
    const { units, startDate: _startDate, ...pureLeaseRow } = row;
    return {
      lease: mapLeaseRow(pureLeaseRow as unknown as Parameters<typeof mapLeaseRow>[0]),
      unitId: units?.id ?? null,
      unitLabel: units?.unit_label ?? null,
      propertyId: units?.properties?.id ?? null,
      propertyNickname: units?.properties?.nickname ?? null,
    };
  };

  const { current, history } = pickCurrentLease(candidates);
  return {
    current: current ? toContext(current) : null,
    history: history.map(toContext),
  };
}

function TenantDetailView({
  tenant,
  canEdit,
  canInvite = false,
  invitations = [],
  portalStatus,
  leaseContext,
  tenancyHistory,
  invoices,
  payments,
  maintenanceTickets,
  documents,
  demoMode = false,
}: {
  tenant: Tenant;
  canEdit: boolean;
  canInvite?: boolean;
  invitations?: TenantInvitation[];
  portalStatus: TenantPortalStatusResult;
  leaseContext: LeaseContext | null;
  documents: DocumentRecord[];
  tenancyHistory: LeaseContext[];
  invoices: InvoiceWithBalance[];
  payments: TenantPaymentLedgerRow[];
  maintenanceTickets: MaintenanceTicket[];
  demoMode?: boolean;
}) {
  // Unified invoice-payment ledger (migration 20260101000158): sum of CURRENT invoice balances
  // across every non-void invoice -- loadInvoicesWithBalances() already zeroes a void invoice's
  // balance, so this never needs its own void filter. One source of truth, shared with
  // /accounting/invoices, Rent Due, and property Accounting -- never a second, independently
  // computed arrears figure.
  const balance = invoices.reduce((sum, inv) => sum + inv.balance, 0);

  const stats: { label: string; value: string; danger?: boolean }[] = [];
  if (leaseContext) {
    stats.push({ label: 'Monthly rent', value: currency(leaseContext.lease.rentAmount) });
    stats.push({ label: 'Balance', value: currency(balance), danger: balance > 0 });
    stats.push({ label: 'Deposit held', value: currency(leaseContext.lease.depositAmount) });
  }

  return (
    <div className="space-y-6 animate-rise">
      <Link
        href="/tenants"
        className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
      >
        ← Back to tenants
      </Link>

      {/* Profile header + stats row adapted from reference/lovable-ui-reference's tenants/index.tsx
          detail panel (UI_INTEGRATION_PLAN.md). Lovable's "Payment score" stat has no real backing
          field anywhere in the schema (no tenant reliability/scoring metric is tracked) -- omitted
          rather than fabricated, and "Deposit held" uses the lease's real deposit_amount instead of
          Lovable's rent*2 placeholder formula. "Message"/"Renew lease" action buttons are also
          omitted: neither has a real feature behind it yet (no messaging system, no lease-renewal
          workflow), and a button that does nothing is a fabricated affordance (same reasoning
          already applied to Units' omitted fake pagination controls). */}
      <Panel bodyClassName="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar initials={initialsFor(tenant.fullName)} className="h-14 w-14 text-lg" />
            <div className="min-w-0">
              <h1 className="truncate font-display text-xl font-bold text-light-textPrimary dark:text-dark-textPrimary">
                {tenant.fullName}
              </h1>
              <p className="truncate text-[13px] text-light-textMuted dark:text-dark-textMuted">
                {leaseContext && leaseContext.propertyId && leaseContext.unitId ? (
                  <>
                    <Link href={`/properties/${leaseContext.propertyId}`} className="hover:underline">
                      {leaseContext.propertyNickname}
                    </Link>
                    {' · '}
                    <Link
                      href={`/properties/${leaseContext.propertyId}/units/${leaseContext.unitId}`}
                      className="hover:underline"
                    >
                      {leaseContext.unitLabel}
                    </Link>
                  </>
                ) : (
                  'No active lease'
                )}
                {' · tenant since '}
                {longDate(tenant.createdAt)}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <StatusBadge presentation={TENANT_STATUS_PRESENTATION[tenant.status]} />
                <span className={`text-xs font-medium ${PORTAL_STATUS_TONE[portalStatus.status]}`}>
                  Portal: {portalStatus.label}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-light-textMuted dark:text-dark-textMuted">
                {tenant.email ? (
                  <span className="flex items-center gap-1.5">
                    <Mail size={13} aria-hidden="true" /> {tenant.email}
                  </span>
                ) : null}
                {tenant.phone ? (
                  <span className="flex items-center gap-1.5">
                    <Phone size={13} aria-hidden="true" /> {tenant.phone}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          {canEdit ? (
            <Link href={`/tenants/${tenant.id}/edit`}>
              <Button variant="secondary" size="sm">
                Edit
              </Button>
            </Link>
          ) : null}
        </div>

        {stats.length > 0 ? (
          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-light-border pt-4 sm:grid-cols-3 dark:border-dark-border">
            {stats.map((s) => (
              <div key={s.label}>
                <p className="text-[11px] text-light-textMuted dark:text-dark-textMuted">
                  {s.label}
                </p>
                <p
                  className={`tabular mt-0.5 text-[17px] font-semibold ${
                    s.danger
                      ? 'text-light-statusOverdue dark:text-dark-statusOverdue'
                      : 'text-light-textPrimary dark:text-dark-textPrimary'
                  }`}
                >
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </Panel>

      {/* Portal status itself is always shown in the header badge above -- this panel is only the
          ACTION (send/resend/revoke an invitation), gated to canInvite same as before. A tenant
          who already has an account needs no action here at all. */}
      {!tenant.userId && canInvite ? (
        <TenantInvitationPanel
          tenantId={tenant.id}
          hasEmail={Boolean(tenant.email)}
          hasPhone={Boolean(tenant.phone)}
          invitations={invitations}
          demoMode={demoMode}
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SimpleTabs
            tabs={[
              {
                label: 'Lease',
                content: (
                  <LeaseTab leaseContext={leaseContext} tenantId={tenant.id} canEdit={canEdit} />
                ),
              },
              { label: 'Payments', content: <PaymentsTab payments={payments} /> },
              { label: 'Maintenance', content: <MaintenanceTab tickets={maintenanceTickets} /> },
              { label: 'Notes', content: <NotesTab /> },
            ]}
          />
        </div>

        <div className="space-y-4">
          {/* documents.tenant_id (migration 20260101000085) -- overnight V1 completion pass, Part
              A gap 3. Real query replacing the previous hardcoded "not linked yet" placeholder. */}
          <Panel
            title="Documents"
            bodyClassName="p-4"
            actions={
              canEdit ? (
                <Link
                  href={`/documents/new?tenantId=${tenant.id}`}
                  className="text-xs font-medium text-light-accent hover:underline dark:text-dark-accent"
                >
                  + Upload document
                </Link>
              ) : undefined
            }
          >
            {documents.length === 0 ? (
              <p className="flex items-center gap-2 px-2 py-2 text-[13px] text-light-textMuted dark:text-dark-textMuted">
                <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                No documents linked to this tenant yet.
              </p>
            ) : (
              <ul className="divide-y divide-light-border dark:divide-dark-border">
                {documents.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/documents/${d.id}`}
                      className="flex items-center gap-2 px-2 py-2 text-[13px] text-light-textPrimary hover:underline dark:text-dark-textPrimary"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-light-textMuted dark:text-dark-textMuted" aria-hidden="true" />
                      <span className="truncate">{d.originalFileName}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {/* emergency_contact_name/phone/relationship (migration 20260101000151) -- overnight V1
              completion pass, Part A gap 4. Real fields replacing the previous hardcoded "not
              captured" placeholder; still shown as "Not captured yet." when genuinely unset. */}
          <Panel title="Emergency contact" bodyClassName="p-5">
            {tenant.emergencyContactName ||
            tenant.emergencyContactPhone ||
            tenant.emergencyContactRelationship ? (
              <div className="space-y-1 text-[13px]">
                <p className="font-medium text-light-textPrimary dark:text-dark-textPrimary">
                  {tenant.emergencyContactName || '—'}
                  {tenant.emergencyContactRelationship ? ` · ${tenant.emergencyContactRelationship}` : ''}
                </p>
                {tenant.emergencyContactPhone ? (
                  <p className="flex items-center gap-1.5 text-light-textMuted dark:text-dark-textMuted">
                    <Phone size={13} aria-hidden="true" /> {tenant.emergencyContactPhone}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-light-surfaceStrong text-light-textMuted dark:bg-dark-surfaceStrong dark:text-dark-textMuted">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                </span>
                <p className="text-[13px] text-light-textMuted dark:text-dark-textMuted">
                  Not captured yet.
                  {canEdit ? (
                    <>
                      {' '}
                      <Link href={`/tenants/${tenant.id}/edit`} className="text-light-accent hover:underline dark:text-dark-accent">
                        Add contact
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {tenancyHistory.length > 0 ? (
        <Panel title={`Tenancy history (${tenancyHistory.length})`} bodyClassName="p-0">
          <ul className="divide-y divide-light-border dark:divide-dark-border">
            {tenancyHistory.map((h) => (
              <li key={h.lease.id} className="flex items-center justify-between gap-3 px-5 py-3.5 text-[13px]">
                <div className="min-w-0">
                  <p className="truncate font-medium text-light-textPrimary dark:text-dark-textPrimary">
                    {h.propertyId && h.unitId ? (
                      <Link href={`/properties/${h.propertyId}/units/${h.unitId}`} className="hover:underline">
                        {[h.propertyNickname, h.unitLabel].filter(Boolean).join(' · ')}
                      </Link>
                    ) : (
                      [h.propertyNickname, h.unitLabel].filter(Boolean).join(' · ') || '—'
                    )}
                  </p>
                  <p className="text-[11px] text-light-textMuted dark:text-dark-textMuted">
                    {longDate(h.lease.startDate)} – {h.lease.endDate ? longDate(h.lease.endDate) : 'ongoing'}
                    {' · '}
                    {currency(h.lease.rentAmount)}/{h.lease.rentFrequency}
                  </p>
                </div>
                <StatusBadge presentation={LEASE_STATUS_PRESENTATION[h.lease.status]} />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
        The Lease tab above shows only the tenant's current or most recent tenancy — every earlier
        tenancy for this tenant is preserved in Tenancy history above, never overwritten.
      </p>
    </div>
  );
}

function LeaseTab({
  leaseContext,
  tenantId,
  canEdit,
}: {
  leaseContext: LeaseContext | null;
  tenantId: string;
  canEdit: boolean;
}) {
  if (!leaseContext) {
    return (
      <div className="space-y-3 p-5">
        <p className="text-[13px] text-light-textMuted dark:text-dark-textMuted">
          No lease on record for this tenant yet.
        </p>
        {canEdit ? (
          <Link href={`/tenants/${tenantId}/leases/new`}>
            <Button variant="secondary" size="sm">
              + Add lease
            </Button>
          </Link>
        ) : null}
      </div>
    );
  }
  const { lease, unitLabel, propertyNickname } = leaseContext;

  // "Escalation" and "Signed" rows from Lovable's static mock are omitted -- neither an annual
  // escalation rate nor a signature timestamp is a real field on public.leases
  // (supabase/migrations/20260101000030_leases.sql).
  const rows: [string, string][] = [
    ['Unit · Property', [unitLabel, propertyNickname].filter(Boolean).join(' · ') || '—'],
    ['Rent', `${currency(lease.rentAmount)} · ${lease.rentFrequency}`],
    ['Start date', longDate(lease.startDate)],
    ['End date', lease.endDate ? longDate(lease.endDate) : 'Month-to-month'],
    ['Deposit', currency(lease.depositAmount)],
  ];

  return (
    <dl className="divide-y divide-light-border dark:divide-dark-border">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 px-5 py-3 text-[13px]">
          <dt className="text-light-textMuted dark:text-dark-textMuted">{k}</dt>
          <dd className="truncate font-medium text-light-textPrimary dark:text-dark-textPrimary">
            {v}
          </dd>
        </div>
      ))}
      <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 px-5 py-3 text-[13px]">
        <dt className="text-light-textMuted dark:text-dark-textMuted">Status</dt>
        <dd>
          <StatusBadge presentation={LEASE_STATUS_PRESENTATION[lease.status]} />
        </dd>
      </div>
    </dl>
  );
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  eft: 'EFT',
  cash: 'Cash',
  card: 'Card',
  debit_order: 'Debit order',
  bank_deposit: 'Bank deposit',
  other: 'Other',
};

/**
 * A real invoice_payments-based ledger (unified invoice-payment ledger, migration
 * 20260101000158) -- covers both manual and rent-sourced invoices, never rent_schedules rendered
 * as if it were a record of money moved (that was this tab's actual bug before this pass: it
 * listed OBLIGATIONS, not payments, and a schedule with zero payments recorded against it could
 * still show "Paid" purely from bank-reconciliation matching that never touched invoice_payments
 * at all).
 */
function PaymentsTab({ payments }: { payments: TenantPaymentLedgerRow[] }) {
  if (payments.length === 0) {
    return (
      <p className="p-5 text-[13px] text-light-textMuted dark:text-dark-textMuted">
        No payments recorded for this tenant yet.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-light-border dark:divide-dark-border">
      {payments.map((p) => (
        <li key={p.id} className="px-5 py-3.5 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={`/accounting/invoices/${p.invoiceId}`}
                className={
                  p.reversedAt
                    ? 'font-medium text-light-textMuted line-through hover:underline dark:text-dark-textMuted'
                    : 'font-medium text-light-accent hover:underline dark:text-dark-accent'
                }
              >
                {p.invoiceNumber}
              </Link>
              <p className="truncate text-xs text-light-textMuted dark:text-dark-textMuted">
                {p.description}
                {p.method ? ` · ${PAYMENT_METHOD_LABELS[p.method] ?? p.method}` : ''}
                {p.reference ? ` · ${p.reference}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-light-textMuted dark:text-dark-textMuted">
                {new Date(p.paidAt).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
              <span
                className={
                  p.reversedAt
                    ? 'tabular text-light-textMuted line-through dark:text-dark-textMuted'
                    : 'tabular font-semibold text-light-textPrimary dark:text-dark-textPrimary'
                }
              >
                {currency(p.amount)}
              </span>
            </div>
          </div>
          <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
            {p.reversedAt ? (
              <span className="text-light-statusOverdue dark:text-dark-statusOverdue">
                Reversed by {p.reversedByName ?? 'a team member'}
                {p.reversalReason ? `: ${p.reversalReason}` : ''}
              </span>
            ) : (
              <>Recorded by {p.recordedByName ?? 'a team member'}</>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}

function MaintenanceTab({ tickets }: { tickets: MaintenanceTicket[] }) {
  if (tickets.length === 0) {
    return (
      <p className="p-5 text-[13px] text-light-textMuted dark:text-dark-textMuted">
        No maintenance tickets logged for this tenant yet.
      </p>
    );
  }
  return (
    // Lovable's per-ticket percent-complete Meter bar is fabricated (public.maintenance_tickets has
    // no percent-complete field, only a 4-state status) -- replaced with the same StatusBadge used
    // on the real Maintenance list/detail pages.
    <ul className="divide-y divide-light-border dark:divide-dark-border">
      {tickets.map((t) => (
        <li key={t.id} className="px-5 py-3.5">
          <Link
            href={`/maintenance/${t.id}`}
            className="flex items-center justify-between gap-3 hover:underline"
          >
            <span className="truncate text-[13px] font-medium text-light-textPrimary dark:text-dark-textPrimary">
              {t.summary}
            </span>
            <StatusBadge presentation={MAINTENANCE_STATUS_PRESENTATION[t.status]} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function NotesTab() {
  // No notes/CRM table exists for tenants. Lovable's own textarea here has no onChange/onSubmit
  // handler in its source either -- it's inert there too -- but leaving a free-text input with no
  // wiring would read as a real, persisting note field to a user, which is more actively misleading
  // than the already-precedented inert controls elsewhere (e.g. a disabled filter button), so it's
  // omitted rather than reproduced.
  return (
    <p className="p-5 text-[13px] text-light-textMuted dark:text-dark-textMuted">
      Notes aren't tracked for tenants yet.
    </p>
  );
}
