import type { AuditEvent } from '@propvault/types';

// PWA_V1_COMPLETION_PLAN.md #14 -- audit_events is written to throughout (API_SPEC.md §0's
// every-mutation-is-audited rule) but nothing read it anywhere: not on customer detail, not as
// its own page (SUPER_ADMIN.md §7 gap list). Most-recent-20, no pagination -- matches this page's
// existing "recent payments" list's own scope, a full paginated/filterable audit page is real
// follow-on work if usage grows past what a detail-page panel should show.
export function AuditLogPanel({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Audit log
        </h2>
        <p className="mt-2 text-xs text-light-textMuted dark:text-dark-textMuted">
          No audit events recorded yet.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Audit log{' '}
        <span className="font-normal text-light-textMuted dark:text-dark-textMuted">
          (most recent {events.length})
        </span>
      </h2>
      <div className="mt-2 overflow-x-auto rounded-card border border-light-border dark:border-dark-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-light-border bg-light-surfaceRaised dark:border-dark-border dark:bg-dark-surfaceRaised">
            <tr>
              <th className="px-3 py-2 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                When
              </th>
              <th className="px-3 py-2 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                Actor
              </th>
              <th className="px-3 py-2 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                Action
              </th>
              <th className="px-3 py-2 font-medium text-light-textSecondary dark:text-dark-textSecondary">
                Entity
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr
                key={e.id}
                className="border-b border-light-border last:border-b-0 dark:border-dark-border"
              >
                <td className="px-3 py-2 text-xs text-light-textMuted dark:text-dark-textMuted">
                  {new Date(e.createdAt).toLocaleString('en-ZA')}
                </td>
                <td className="px-3 py-2 text-xs text-light-textPrimary dark:text-dark-textPrimary">
                  {e.actorType}
                </td>
                <td className="px-3 py-2 text-xs text-light-textPrimary dark:text-dark-textPrimary">
                  {e.action}
                </td>
                <td className="px-3 py-2 text-xs text-light-textMuted dark:text-dark-textMuted">
                  {e.entityType}:{e.entityId.slice(0, 8)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
