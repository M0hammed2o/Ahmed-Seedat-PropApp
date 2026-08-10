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
export function MaintenanceBoard({
  tickets,
  unitLabelById,
}: {
  tickets: MaintenanceTicket[];
  unitLabelById?: Map<string, string>;
}) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised">
        <EmptyState icon={<span className="text-lg">🔧</span>} title="No maintenance tickets yet" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {MAINTENANCE_STATUSES.map((status) => {
        const columnTickets = tickets.filter((t) => t.status === status);
        return (
          <div
            key={status}
            className="overflow-hidden rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised"
          >
            <div className="flex items-center justify-between border-b border-light-border bg-light-surfaceStrong px-3.5 py-2.5 dark:border-dark-border dark:bg-dark-surfaceStrong">
              <StatusBadge presentation={MAINTENANCE_STATUS_PRESENTATION[status]} />
              <span className="tabular-nums-feature rounded-pill bg-light-surfaceRaised px-1.5 py-0.5 text-[10px] font-semibold text-light-textMuted dark:bg-dark-surfaceRaised dark:text-dark-textMuted">
                {columnTickets.length}
              </span>
            </div>
            <div className="flex flex-col gap-2 p-3">
              {columnTickets.length === 0 ? (
                <p className="text-xs text-light-textMuted dark:text-dark-textMuted">None</p>
              ) : (
                columnTickets.map((ticket) => (
                  <Link
                    key={ticket.id}
                    href={`/maintenance/${ticket.id}`}
                    className="block rounded-lg border border-light-border p-2.5 text-xs transition-colors hover:border-light-accent/30 hover:bg-light-accentSoft dark:border-dark-border dark:hover:border-dark-accent/30 dark:hover:bg-dark-accentSoft"
                  >
                    <p className="font-medium text-light-textPrimary dark:text-dark-textPrimary">
                      {ticket.summary}
                    </p>
                    <p className="mt-0.5 text-[11px] text-light-textMuted dark:text-dark-textMuted">
                      {ticket.unitId ? (unitLabelById?.get(ticket.unitId) ?? 'Unit') : 'Common area'}
                    </p>
                    <div className="mt-1.5">
                      <StatusBadge
                        presentation={MAINTENANCE_PRIORITY_PRESENTATION[ticket.priority]}
                      />
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
