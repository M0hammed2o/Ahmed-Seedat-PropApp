import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { MaintenanceTicket } from '@propvault/types';
import { MAINTENANCE_PRIORITY_PRESENTATION, MAINTENANCE_STATUS_PRESENTATION } from '@propvault/ui';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { mapMaintenanceTicketRow } from '@/lib/operations';
import { resolvePortalSession, findActiveMembership, canWriteOrgRecords } from '@/lib/orgSession';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type RouteParams = { params: Promise<{ id: string }> };

const DEMO_TICKET: MaintenanceTicket = {
  id: 'demo-ticket-1',
  orgId: 'demo-org-1',
  propertyId: 'demo-property-1',
  unitId: 'demo-unit-1',
  leaseId: 'demo-lease-1',
  tenantId: null,
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
};

export default async function MaintenanceDetailPage({ params }: RouteParams) {
  const { id } = await params;

  if (ADMIN_DEMO_MODE) {
    if (id !== 'demo-ticket-1') notFound();
    return <MaintenanceDetailView ticket={DEMO_TICKET} propertyNickname="Sea Point Apartment" canEdit />;
  }

  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase
    .from('maintenance_tickets')
    .select('*, properties(nickname)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load maintenance ticket: ${error.message}`);
  if (!data) notFound();

  const { properties, ...ticketRow } = data as typeof data & { properties: { nickname: string } | null };
  const ticket = mapMaintenanceTicketRow(ticketRow);

  const session = await resolvePortalSession();
  const membership = session ? findActiveMembership(session, ticket.orgId) : undefined;
  const canEdit = Boolean(membership && canWriteOrgRecords(membership.role));

  return <MaintenanceDetailView ticket={ticket} propertyNickname={properties?.nickname} canEdit={canEdit} />;
}

function MaintenanceDetailView({
  ticket,
  propertyNickname,
  canEdit,
}: {
  ticket: MaintenanceTicket;
  propertyNickname?: string;
  canEdit: boolean;
}) {
  return (
    <div>
      <Link
        href={`/properties/${ticket.propertyId}`}
        className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
      >
        ← Back to {propertyNickname ?? 'property'}
      </Link>

      <div className="mt-2">
        <PageHeader
          title={ticket.summary}
          actions={
            canEdit ? (
              <Link href={`/maintenance/${ticket.id}/edit`}>
                <Button variant="secondary" size="sm">
                  Edit
                </Button>
              </Link>
            ) : undefined
          }
        />
      </div>
      <div className="mt-1 flex gap-3">
        <StatusBadge presentation={MAINTENANCE_STATUS_PRESENTATION[ticket.status]} />
        <StatusBadge presentation={MAINTENANCE_PRIORITY_PRESENTATION[ticket.priority]} />
      </div>

      {ticket.description ? (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">Description</h2>
          <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">{ticket.description}</p>
        </div>
      ) : null}

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Reported</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {new Date(ticket.createdAt).toLocaleDateString('en-ZA')}
          </dd>
        </div>
        <div>
          <dt className="text-light-textMuted dark:text-dark-textMuted">Resolved</dt>
          <dd className="text-light-textPrimary dark:text-dark-textPrimary">
            {ticket.resolvedAt ? new Date(ticket.resolvedAt).toLocaleDateString('en-ZA') : '—'}
          </dd>
        </div>
      </dl>

      <p className="mt-8 text-xs text-light-textMuted dark:text-dark-textMuted">
        Vendor assignment and photo attachments are evidenced in the reference product
        (PROPVIEW_SCREENSHOT_AUDIT.md) and supported by the underlying schema, but not wired into
        this page yet — no Vendors module UI exists in this codebase yet to assign against, and
        photo upload depends on the same document-storage work Documents/OCR (M11/M12) already
        ships at the API layer.
      </p>
    </div>
  );
}
