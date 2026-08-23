'use client';

import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { safeJson } from '@/lib/safeJson';

// Organisation -> Activity (item 4, staff security + audit hardening pass, this date).
// Principal-only -- the server page above already gated access; this client only ever talks to
// GET /api/v1/organizations/:orgId/activity, which re-enforces the same floor itself.

interface StaffOption {
  userId: string;
  label: string;
}

interface PropertyOption {
  id: string;
  nickname: string;
}

interface ActivityRow {
  id: string;
  actorUserId: string | null;
  actorType: 'user' | 'system' | 'api' | 'ai_assisted';
  actorRole: string | null;
  actorDisplayName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  propertyId: string | null;
  createdAt: string;
}

const CATEGORIES = [
  { value: '', label: 'All activity' },
  { value: 'staff', label: 'Staff & access' },
  { value: 'property', label: 'Properties' },
  { value: 'unit', label: 'Units' },
  { value: 'tenant', label: 'Tenants' },
  { value: 'lease', label: 'Leases' },
  { value: 'accounting', label: 'Payments & accounting' },
  { value: 'document', label: 'Documents' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'inspection', label: 'Inspections' },
  { value: 'billing', label: 'Billing' },
];

const ENTITY_LABELS: Record<string, string> = {
  organization_members: 'Staff member',
  organization_invites: 'Staff invitation',
  organization_staff_provisions: 'Staff activation',
  property_access: 'Property access',
  properties: 'Property',
  units: 'Unit',
  tenants: 'Tenant',
  leases: 'Lease',
  maintenance_tickets: 'Maintenance ticket',
  inspections: 'Inspection',
  accounting_periods: 'Accounting period',
  expenses: 'Expense',
  journal_entries: 'Journal entry',
  cash_receipts: 'Cash receipt',
  owner_statements: 'Owner statement',
  payment_reports: 'Payment report',
  levy_statements: 'Levy statement',
  documents: 'Document',
  extraction_jobs: 'Document extraction',
  extraction_results: 'Document extraction',
};

const ACTION_LABELS: Record<string, string> = {
  'staff.provision_created': 'Added a staff member',
  'staff.provisioned_existing_user': 'Added an existing user as staff',
  'staff.activated': 'Staff member activated their account',
  'staff.removed': 'Removed staff access',
  'staff.role_changed': 'Changed a staff member’s role',
  'staff.property_access_mode_changed': 'Changed a staff member’s property access mode',
  'staff.property_access_granted': 'Granted property access',
  'staff.property_access_revoked': 'Revoked property access',
  'staff.invite_revoked': 'Cancelled a staff invitation',
  'organization_invite.revoked': 'Cancelled an invitation',
};

function actionLabel(action: string, entityType: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const entityLabel = ENTITY_LABELS[entityType] ?? entityType.replace(/_/g, ' ');
  if (action.endsWith('.insert')) return `Created ${entityLabel.toLowerCase()}`;
  if (action.endsWith('.delete')) return `Deleted ${entityLabel.toLowerCase()}`;
  if (action.endsWith('.update')) return `Updated ${entityLabel.toLowerCase()}`;
  return action.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeFieldName(key: string): string {
  return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

// Best-effort human-readable diff, same convention as /owner-portal/activity's own
// describeChanges() -- only surfaces fields that actually changed, never the raw jsonb.
function describeChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string | null {
  if (!after) return before ? 'Record removed.' : null;
  if (!before) return null;

  const changes: string[] = [];
  for (const key of Object.keys(after)) {
    if (['updated_at', 'created_at', 'id', 'org_id'].includes(key)) continue;
    const beforeVal = before[key];
    const afterVal = after[key];
    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      changes.push(`${humanizeFieldName(key)}: ${formatValue(beforeVal)} → ${formatValue(afterVal)}`);
    }
  }
  return changes.length > 0 ? changes.slice(0, 4).join(' · ') : null;
}

export function ActivityLogClient({
  orgId,
  staffOptions,
  properties,
}: {
  orgId: string;
  staffOptions: StaffOption[];
  properties: PropertyOption[];
}) {
  const [actorUserId, setActorUserId] = useState('');
  const [category, setCategory] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildParams = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();
      if (actorUserId) params.set('actorUserId', actorUserId);
      if (category) params.set('category', category);
      if (propertyId) params.set('propertyId', propertyId);
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to).toISOString());
      if (search.trim()) params.set('search', search.trim());
      if (cursor) params.set('cursor', cursor);
      return params;
    },
    [actorUserId, category, propertyId, from, to, search],
  );

  const load = useCallback(async () => {
    setError(null);
    setActivity(null);
    const res = await fetch(`/api/v1/organizations/${orgId}/activity?${buildParams().toString()}`);
    const body = await safeJson(res);
    if (!res.ok) {
      setError(body.error?.message ?? 'Failed to load activity.');
      setActivity([]);
      return;
    }
    setActivity(body.activity ?? []);
    setNextCursor(body.nextCursor ?? null);
  }, [orgId, buildParams]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/v1/organizations/${orgId}/activity?${buildParams(nextCursor).toString()}`,
      );
      const body = await safeJson(res);
      if (!res.ok) {
        setError(body.error?.message ?? 'Failed to load more activity.');
        return;
      }
      setActivity((prev) => [...(prev ?? []), ...(body.activity ?? [])]);
      setNextCursor(body.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="Filters">
        <div className="flex flex-wrap gap-3">
          <label className="block text-xs">
            <span className="text-muted-foreground">Staff member</span>
            <select
              value={actorUserId}
              onChange={(e) => setActorUserId(e.target.value)}
              className={selectClass}
            >
              <option value="">All staff</option>
              {staffOptions.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs">
            <span className="text-muted-foreground">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={selectClass}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          {properties.length > 0 ? (
            <label className="block text-xs">
              <span className="text-muted-foreground">Property</span>
              <select
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                className={selectClass}
              >
                <option value="">All properties</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nickname}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block text-xs">
            <span className="text-muted-foreground">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={selectClass}
            />
          </label>

          <label className="block text-xs">
            <span className="text-muted-foreground">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={selectClass}
            />
          </label>

          <label className="block min-w-[180px] flex-1 text-xs">
            <span className="text-muted-foreground">Search</span>
            <input
              type="text"
              placeholder="Search activity…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={selectClass}
            />
          </label>
        </div>
      </Panel>

      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}

      {activity === null ? (
        <p className="panel py-8 text-center text-sm text-muted-foreground">Loading activity…</p>
      ) : activity.length === 0 ? (
        <div className="rounded-card border border-light-border bg-light-surfaceRaised dark:border-dark-border dark:bg-dark-surfaceRaised">
          <EmptyState
            icon={<History size={20} aria-hidden="true" />}
            title="No activity yet"
            description="Changes your team makes will appear here -- who did what, and when."
          />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-light-border overflow-hidden rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:divide-dark-border dark:border-dark-border dark:bg-dark-surfaceRaised">
            {activity.map((a) => {
              const changeSummary = describeChanges(a.before, a.after);
              return (
                <li key={a.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
                        {a.actorDisplayName ??
                          (a.actorType === 'system'
                            ? 'System'
                            : a.actorType === 'ai_assisted'
                              ? 'AI assistant'
                              : 'Unknown user')}
                      </p>
                      <p className="mt-0.5 text-sm text-light-textSecondary dark:text-dark-textSecondary">
                        {actionLabel(a.action, a.entityType)}
                      </p>
                      {changeSummary ? (
                        <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
                          {changeSummary}
                        </p>
                      ) : null}
                    </div>
                    <p className="shrink-0 text-xs text-light-textMuted dark:text-dark-textMuted">
                      {new Date(a.createdAt).toLocaleString('en-ZA', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          {nextCursor ? (
            <div className="flex justify-center">
              <Button size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

const selectClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-2 py-1.5 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
