import Link from 'next/link';
import type { MaintenanceTicket } from '@propvault/types';
import { MAINTENANCE_STATUSES } from '@propvault/types';
import { MAINTENANCE_PRIORITY_PRESENTATION, MAINTENANCE_STATUS_PRESENTATION } from '@propvault/ui';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';

// PROPVIEW_SCREENSHOT_AUDIT.md IMG_7967-7968's evidenced "Maintenance Board": KPI row + kanban
// columns (To Do/In Progress/Pending Approval/Completed). Grouped-by-status columns, not full
// drag-and-drop kanban -- status changes go through the ticket detail/edit page's server-validated
// transition, not a drag gesture (a confirmed, honest V1 scope reduction, same category as
// Portfolio Map's "no GIS/heatmap layers").
export function MaintenanceBoard({ tickets }: { tickets: MaintenanceTicket[] }) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-lg border border-light-border dark:border-dark-border">
        <EmptyState icon={<span className="text-lg">🔧</span>} title="No maintenance tickets yet" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {MAINTENANCE_STATUSES.map((status) => {
        const columnTickets = tickets.filter((t) => t.status === status);
        return (
          <div key={status} className="rounded-lg border border-light-border dark:border-dark-border">
            <div className="flex items-center justify-between border-b border-light-border px-3 py-2 dark:border-dark-border">
              <StatusBadge presentation={MAINTENANCE_STATUS_PRESENTATION[status]} />
              <span className="text-xs text-light-textMuted dark:text-dark-textMuted">{columnTickets.length}</span>
            </div>
            <div className="flex flex-col gap-2 p-3">
              {columnTickets.length === 0 ? (
                <p className="text-xs text-light-textMuted dark:text-dark-textMuted">None</p>
              ) : (
                columnTickets.map((ticket) => (
                  <Link
                    key={ticket.id}
                    href={`/maintenance/${ticket.id}`}
                    className="block rounded-md border border-light-border p-2 text-xs hover:bg-light-surfaceRaised dark:border-dark-border dark:hover:bg-dark-surfaceRaised"
                  >
                    <p className="font-medium text-light-textPrimary dark:text-dark-textPrimary">{ticket.summary}</p>
                    <div className="mt-1">
                      <StatusBadge presentation={MAINTENANCE_PRIORITY_PRESENTATION[ticket.priority]} />
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
