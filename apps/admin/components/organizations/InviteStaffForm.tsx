'use client';

import { useState, type FormEvent } from 'react';
import type {
  OrganizationMemberRole,
  PropertyAccessMode,
  StaffPropertyRole,
} from '@propvault/types';
import { STAFF_PROPERTY_ROLES } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { safeJson } from '@/lib/safeJson';

// Owner + staff access completion pass (WORKLOG.md this date): /organization/staff had no
// invitation workflow at all (Team list + mode toggles existed, no "+ Invite" anywhere) --
// POST /api/v1/organizations/:orgId/invites itself already worked end-to-end (create_organization
// invite/accept_organization_invite, migrations 20260101000018/021/026), just unreachable from any
// UI. Reuses the existing organization_member_role model, extended (20260101000089) to also carry
// property_access_mode/selected properties -- not a second RBAC system.

const ORG_ROLE_LABELS: Record<OrganizationMemberRole, string> = {
  principal: 'Principal',
  manager: 'Manager',
  agent: 'Agent',
  accountant: 'Accountant',
  viewer: 'Viewer',
};

const PROPERTY_ROLE_LABELS: Record<StaffPropertyRole, string> = {
  administrator: 'Administrator',
  property_manager: 'Property Manager',
  accountant: 'Accountant',
  maintenance_manager: 'Maintenance Manager',
  read_only: 'Read Only',
};

interface PropertyOption {
  id: string;
  nickname: string;
}

export function InviteStaffForm({
  orgId,
  properties,
  invitableRoles,
  onInvited,
  onCancel,
}: {
  orgId: string;
  properties: PropertyOption[];
  /** MAX_INVITABLE_ROLE_FOR mirrored client-side purely for a tighter dropdown -- the API route's
   * own check is the real authorization boundary regardless of what this form ever offers. */
  invitableRoles: OrganizationMemberRole[];
  onInvited: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrganizationMemberRole>(invitableRoles[0] ?? 'agent');
  const [mode, setMode] = useState<PropertyAccessMode>('all');
  const [propertyRole, setPropertyRole] = useState<StaffPropertyRole>('read_only');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const filteredProperties = properties.filter((p) =>
    p.nickname.toLowerCase().includes(search.trim().toLowerCase()),
  );

  function toggleProperty(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    if (mode === 'selected' && selectedIds.size === 0) {
      setError('Select at least one property, or choose All properties.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/v1/organizations/${orgId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || null,
          email,
          role,
          propertyAccessMode: mode,
          selectedProperties:
            mode === 'selected'
              ? [...selectedIds].map((propertyId) => ({ propertyId, propertyRole }))
              : [],
        }),
      });
      const body = await safeJson(response);
      if (!response.ok) {
        setFieldErrors(body.error?.field_errors ?? {});
        setError(body.error?.message ?? 'Failed to send invitation.');
        return;
      }
      await onInvited();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel title="Invite staff member">
      <form onSubmit={submit} className="max-w-lg space-y-3">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}

        <label className="block text-xs">
          <span className="text-muted-foreground">Name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>

        <label className="block text-xs">
          <span className="text-muted-foreground">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
          {fieldErrors.email?.length ? (
            <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
              {fieldErrors.email[0]}
            </p>
          ) : null}
        </label>

        <label className="block text-xs">
          <span className="text-muted-foreground">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as OrganizationMemberRole)}
            className={inputClass}
          >
            {invitableRoles.map((r) => (
              <option key={r} value={r}>
                {ORG_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>

        <div className="text-xs">
          <span className="text-muted-foreground">Property access</span>
          <div className="mt-1 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === 'all' ? 'primary' : 'secondary'}
              onClick={() => setMode('all')}
            >
              All properties
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'selected' ? 'primary' : 'secondary'}
              onClick={() => setMode('selected')}
            >
              Selected properties
            </Button>
          </div>
        </div>

        {mode === 'selected' ? (
          <div className="rounded-lg border border-light-border p-3 dark:border-dark-border">
            <label className="block text-xs">
              <span className="text-muted-foreground">Role on selected properties</span>
              <select
                value={propertyRole}
                onChange={(e) => setPropertyRole(e.target.value as StaffPropertyRole)}
                className={inputClass}
              >
                {STAFF_PROPERTY_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {PROPERTY_ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block text-xs">
              <span className="text-muted-foreground">Search properties</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type to filter…"
                className={inputClass}
              />
            </label>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {filteredProperties.length === 0 ? (
                <li className="text-xs text-muted-foreground">No matching properties.</li>
              ) : (
                filteredProperties.map((p) => (
                  <li key={p.id}>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleProperty(p.id)}
                      />
                      {p.nickname}
                    </label>
                  </li>
                ))
              )}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {selectedIds.size} propert{selectedIds.size === 1 ? 'y' : 'ies'} selected
            </p>
          </div>
        ) : null}

        <div className="flex gap-2 pt-2">
          <Button type="submit" variant="primary" size="sm" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send invitation'}
          </Button>
          <Button type="button" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Panel>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
