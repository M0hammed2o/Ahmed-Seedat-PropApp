import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Mail, Phone, FileText, ShieldCheck } from 'lucide-react';
import type { Tenant, TenantInvitation, Lease, RentSchedule, MaintenanceTicket } from '@propvault/types';
import {
  TENANT_STATUS_PRESENTATION,
  LEASE_STATUS_PRESENTATION,
  RENT_SCHEDULE_STATUS_PRESENTATION,
  MAINTENANCE_STATUS_PRESENTATION,
} from '@propvault/ui';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapTenantRow, mapLeaseRow, mapRentScheduleRow } from '@/lib/leasing';
import { mapMaintenanceTicketRow } from '@/lib/operations';
import { mapTenantInvitationRow } from '@/lib/tenantInvitations';
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
  return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' });
}

type RouteParams = { params: Promise<{ id: string }> };

interface LeaseContext {
  lease: Lease;
  unitLabel: string | null;
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
  unitLabel: 'Unit 1',
  propertyNickname: 'Sea Point Apartment',
};

const DEMO_RENT_SCHEDULES: RentSchedule[] = [
  { id: 'demo-rs-1', orgId: 'demo-org-1', leaseId: 'demo-lease-1', dueDate: '2026-08-01', amount: 12500, status: 'overdue', generatedAt: '2026-08-01T00:00:00Z' },
  { id: 'demo-rs-2', orgId: 'demo-org-1', leaseId: 'demo-lease-1', dueDate: '2026-07-01', amount: 12500, status: 'paid', generatedAt: '2026-07-01T00:00:00Z' },
  { id: 'demo-rs-3', orgId: 'demo-org-1', leaseId: 'demo-lease-1', dueDate: '2026-06-01', amount: 12500, status: 'paid', generatedAt: '2026-06-01T00:00:00Z' },
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
        leaseContext={DEMO_LEASE_CONTEXT}
        rentSchedules={DEMO_RENT_SCHEDULES}
        maintenanceTickets={DEMO_MAINTENANCE_TICKETS}
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

  const leaseContext = await loadLeaseContext(id);

  let rentSchedules: RentSchedule[] = [];
  if (leaseContext) {
    const { data: rsRows, error: rsError } = await supabase
      .from('rent_schedules')
      .select('*')
      .eq('lease_id', leaseContext.lease.id)
      .order('due_date', { ascending: false })
      .limit(5);
    if (rsError) throw new Error(`Failed to load rent schedules: ${rsError.message}`);
    rentSchedules = (rsRows ?? []).map(mapRentScheduleRow);
  }

  const { data: mtRows, error: mtError } = await supabase
    .from('maintenance_tickets')
    .select('*')
    .eq('tenant_id', id)
    .order('created_at', { ascending: false })
    .limit(5);
  if (mtError) throw new Error(`Failed to load maintenance tickets: ${mtError.message}`);
  const maintenanceTickets = (mtRows ?? []).map(mapMaintenanceTicketRow);

  return (
    <TenantDetailView
      tenant={tenant}
      canEdit={canEdit}
      canInvite={canInvite}
      invitations={invitations}
      leaseContext={leaseContext}
      rentSchedules={rentSchedules}
      maintenanceTickets={maintenanceTickets}
    />
  );
}

// A tenant can have multiple leases over time (lease_tenants is a many-to-many join, TASKS.md M10)
// -- this picks the one lease the detail page's Lease/Payments tabs actually describe: the active
// one if there is one, otherwise the most recently started. Full per-lease history (every lease,
// not just this one) is Leases' own vertical slice (routes/leases), not duplicated here.
async function loadLeaseContext(tenantId: string): Promise<LeaseContext | null> {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('lease_tenants')
    .select('leases(*, units(unit_label, properties(nickname)))')
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`Failed to load leases: ${error.message}`);

  const rows = (data ?? []) as unknown as {
    leases:
      | (Record<string, unknown> & {
          status: string;
          start_date: string;
          units: { unit_label: string; properties: { nickname: string } | null } | null;
        })
      | null;
  }[];

  const candidates = rows.map((r) => r.leases).filter((l): l is NonNullable<typeof l> => l !== null);
  candidates.sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (b.status === 'active' && a.status !== 'active') return 1;
    return new Date(b.start_date).getTime() - new Date(a.start_date).getTime();
  });

  const leaseRow = candidates[0];
  if (!leaseRow) return null;

  const { units, ...pureLeaseRow } = leaseRow;
  return {
    lease: mapLeaseRow(pureLeaseRow as unknown as Parameters<typeof mapLeaseRow>[0]),
    unitLabel: units?.unit_label ?? null,
    propertyNickname: units?.properties?.nickname ?? null,
  };
}

function TenantDetailView({
  tenant,
  canEdit,
  canInvite = false,
  invitations = [],
  leaseContext,
  rentSchedules,
  maintenanceTickets,
  demoMode = false,
}: {
  tenant: Tenant;
  canEdit: boolean;
  canInvite?: boolean;
  invitations?: TenantInvitation[];
  leaseContext: LeaseContext | null;
  rentSchedules: RentSchedule[];
  maintenanceTickets: MaintenanceTicket[];
  demoMode?: boolean;
}) {
  const balance = rentSchedules
    .filter((r) => r.status === 'pending' || r.status === 'overdue' || r.status === 'partial')
    .reduce((sum, r) => sum + r.amount, 0);

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
                {leaseContext
                  ? [leaseContext.unitLabel, leaseContext.propertyNickname].filter(Boolean).join(' · ')
                  : 'No active lease'}
                {' · tenant since '}
                {longDate(tenant.createdAt)}
              </p>
              <div className="mt-1">
                <StatusBadge presentation={TENANT_STATUS_PRESENTATION[tenant.status]} />
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
                <p className="text-[11px] text-light-textMuted dark:text-dark-textMuted">{s.label}</p>
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

      {tenant.userId ? (
        <p className="text-xs text-light-statusPaid dark:text-dark-statusPaid">
          This tenant's portal account is linked and active.
        </p>
      ) : canInvite ? (
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
              { label: 'Lease', content: <LeaseTab leaseContext={leaseContext} /> },
              { label: 'Payments', content: <PaymentsTab rentSchedules={rentSchedules} /> },
              { label: 'Maintenance', content: <MaintenanceTab tickets={maintenanceTickets} /> },
              { label: 'Notes', content: <NotesTab /> },
            ]}
          />
        </div>

        <div className="space-y-4">
          {/* No documents row is scoped to a tenant (public.documents only links to a property and
              its uploading user, DATABASE.md §2) -- Lovable's 4 fabricated filenames are replaced
              with a truthful "not linked yet" state, panel kept in place rather than removed. */}
          <Panel title="Documents" bodyClassName="p-4">
            <p className="flex items-center gap-2 px-2 py-2 text-[13px] text-light-textMuted dark:text-dark-textMuted">
              <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
              No documents linked to this tenant yet.
            </p>
          </Panel>
          {/* public.tenants has no emergency-contact field (confirmed against
              supabase/migrations/20260101000028_tenants.sql) -- Lovable's fabricated "Thandi
              Mokoena · Sister" contact is replaced with a truthful "not captured" state. Adding a
              new schema field for this wasn't requested for this batch (unlike estimated_value,
              which was explicitly authorized), so it isn't added speculatively here. */}
          <Panel title="Emergency contact" bodyClassName="p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-light-surfaceStrong text-light-textMuted dark:bg-dark-surfaceStrong dark:text-dark-textMuted">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              </span>
              <p className="text-[13px] text-light-textMuted dark:text-dark-textMuted">Not captured yet.</p>
            </div>
          </Panel>
        </div>
      </div>

      <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
        This tab shows only the tenant's current or most recent lease — full lease history across
        the portfolio lives on the Leases page.
      </p>
    </div>
  );
}

function LeaseTab({ leaseContext }: { leaseContext: LeaseContext | null }) {
  if (!leaseContext) {
    return (
      <p className="p-5 text-[13px] text-light-textMuted dark:text-dark-textMuted">
        No lease on record for this tenant yet.
      </p>
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
          <dd className="truncate font-medium text-light-textPrimary dark:text-dark-textPrimary">{v}</dd>
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

function PaymentsTab({ rentSchedules }: { rentSchedules: RentSchedule[] }) {
  if (rentSchedules.length === 0) {
    return (
      <p className="p-5 text-[13px] text-light-textMuted dark:text-dark-textMuted">
        No rent schedule entries for this tenant yet.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-light-border dark:divide-dark-border">
      {rentSchedules.map((r) => (
        <li key={r.id} className="flex items-center justify-between px-5 py-3.5 text-[13px]">
          <span className="font-medium text-light-textPrimary dark:text-dark-textPrimary">
            {new Date(r.dueDate).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}
          </span>
          <span className="flex items-center gap-3">
            <span className="tabular font-semibold text-light-textPrimary dark:text-dark-textPrimary">
              {currency(r.amount)}
            </span>
            <StatusBadge presentation={RENT_SCHEDULE_STATUS_PRESENTATION[r.status]} />
          </span>
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
          <Link href={`/maintenance/${t.id}`} className="flex items-center justify-between gap-3 hover:underline">
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
