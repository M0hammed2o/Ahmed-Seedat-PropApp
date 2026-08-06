import Link from 'next/link';
import { History } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DEMO_MODE } from '@/lib/demoMode';

type EntityFilter = 'all' | 'cash_receipts' | 'maintenance_tickets' | 'owner_statements';

const FILTERS: { value: EntityFilter; label: string }[] = [
  { value: 'all', label: 'All activity' },
  { value: 'cash_receipts', label: 'Cash receipts' },
  { value: 'maintenance_tickets', label: 'Maintenance' },
  { value: 'owner_statements', label: 'Distributions' },
];

const ENTITY_LABELS: Record<string, string> = {
  cash_receipts: 'Cash receipt',
  maintenance_tickets: 'Maintenance ticket',
  owner_statements: 'Owner statement',
};

interface OwnerActivityRow {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const DEMO_ACTIVITY: OwnerActivityRow[] = [
  {
    id: 'demo-owner-activity-1',
    action: 'maintenance_tickets.update',
    entityType: 'maintenance_tickets',
    createdAt: '2026-07-22T09:15:00Z',
    before: { status: 'to_do' },
    after: { status: 'in_progress' },
  },
  {
    id: 'demo-owner-activity-2',
    action: 'cash_receipts.update',
    entityType: 'cash_receipts',
    createdAt: '2026-07-05T14:00:00Z',
    before: { deposited_at: null },
    after: { deposited_at: '2026-07-05T14:00:00Z' },
  },
];

/**
 * GET /owner-portal/activity (Phase 6, commercial-launch execution plan) -- the "real, filterable
 * audit-log page for owners" the earlier governance research named as still missing (the
 * dashboard's `RecentActivityFeed` caps at 8 rows, no filtering, no before/after display).
 * `audit_events_select_owner_relevant` (migration 20260101000074) already scopes this to exactly
 * the cash_receipts/maintenance_tickets/owner_statements events on the caller's own properties --
 * RLS is the real isolation boundary, same as every other portal page in this codebase.
 */
export default async function OwnerActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  const { entity } = await searchParams;
  const activeFilter: EntityFilter =
    entity === 'cash_receipts' || entity === 'maintenance_tickets' || entity === 'owner_statements'
      ? entity
      : 'all';

  const activity = ADMIN_DEMO_MODE ? DEMO_ACTIVITY : await loadOwnerActivity(activeFilter);

  return (
    <div className="space-y-5 animate-rise">
      <PageHeader
        title="Activity"
        subtitle="Every recorded change to your properties' cash, maintenance, and distributions."
      />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={
              f.value === 'all'
                ? '/owner-portal/activity'
                : `/owner-portal/activity?entity=${f.value}`
            }
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              activeFilter === f.value
                ? 'bg-light-accent text-white dark:bg-dark-accent'
                : 'bg-light-surfaceStrong text-light-textSecondary hover:bg-light-accentSoft dark:bg-dark-surfaceStrong dark:text-dark-textSecondary dark:hover:bg-dark-accentSoft'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {activity.length === 0 ? (
        <div className="rounded-card border border-light-border bg-light-surfaceRaised dark:border-dark-border dark:bg-dark-surfaceRaised">
          <EmptyState
            icon={<History size={20} aria-hidden="true" />}
            title="No activity yet"
            description="Changes to your properties' cash receipts, maintenance, and distributions will appear here."
          />
        </div>
      ) : (
        <ul className="divide-y divide-light-border overflow-hidden rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:divide-dark-border dark:border-dark-border dark:bg-dark-surfaceRaised">
          {activity.map((a) => (
            <li key={a.id} className="px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
                  {ENTITY_LABELS[a.entityType] ?? a.entityType}{' '}
                  {a.action.endsWith('.insert')
                    ? 'created'
                    : a.action.endsWith('.delete')
                      ? 'deleted'
                      : 'updated'}
                </p>
                <p className="shrink-0 text-xs text-light-textMuted dark:text-dark-textMuted">
                  {new Date(a.createdAt).toLocaleString('en-ZA')}
                </p>
              </div>
              {describeChanges(a.before, a.after) ? (
                <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
                  {describeChanges(a.before, a.after)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Best-effort human-readable diff -- only surfaces fields that actually changed between before
// and after, never dumps the raw jsonb (real evidence, not a debug view).
function describeChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string | null {
  if (!after) return before ? 'Record removed.' : null;
  if (!before) return null;

  const changes: string[] = [];
  for (const key of Object.keys(after)) {
    if (key === 'updated_at' || key === 'created_at') continue;
    const beforeVal = before[key];
    const afterVal = after[key];
    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      changes.push(
        `${key.replace(/_/g, ' ')}: ${String(beforeVal ?? '—')} → ${String(afterVal ?? '—')}`,
      );
    }
  }
  return changes.length > 0 ? changes.join('; ') : null;
}

async function loadOwnerActivity(filter: EntityFilter): Promise<OwnerActivityRow[]> {
  const supabase = await getServerSupabaseClient();
  let query = supabase
    .from('audit_events')
    .select('id, action, entity_type, created_at, before, after')
    .order('created_at', { ascending: false })
    .limit(100);

  if (filter !== 'all') query = query.eq('entity_type', filter);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load activity: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    action: row.action as string,
    entityType: row.entity_type as string,
    createdAt: row.created_at as string,
    before: row.before as Record<string, unknown> | null,
    after: row.after as Record<string, unknown> | null,
  }));
}
