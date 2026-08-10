'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

interface Member {
  userId: string;
  role: string;
  propertyAccessMode: 'all' | 'selected';
  joinedAt: string;
  displayName: string | null;
}

interface PropertyOption {
  id: string;
  nickname: string;
}

interface Grant {
  propertyId: string;
  propertyRole: string;
  propertyNickname: string;
}

const PROPERTY_ROLE_LABELS: Record<string, string> = {
  read_only: 'Read only',
  property_manager: 'Property manager',
  accountant: 'Accountant',
  maintenance_manager: 'Maintenance manager',
  owner: 'Owner',
  administrator: 'Administrator',
};

export function StaffAccessPanel({
  orgId,
  properties,
}: {
  orgId: string;
  properties: PropertyOption[];
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/organizations/${orgId}/members`);
    const body = await res.json();
    if (!res.ok) {
      setError(body.error?.message ?? 'Failed to load staff.');
      return;
    }
    setMembers(body.members ?? []);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function setMode(userId: string, mode: 'all' | 'selected') {
    setError(null);
    const res = await fetch(`/api/v1/organizations/${orgId}/members/${userId}/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error?.message ?? 'Failed to change access mode.');
      return;
    }
    await load();
  }

  if (error) {
    return (
      <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
        {error}
      </p>
    );
  }

  if (!members) {
    return <p className="panel py-8 text-center text-sm text-muted-foreground">Loading staff…</p>;
  }

  return (
    <Panel title={`Team (${members.length})`}>
      <ul className="divide-y divide-light-border dark:divide-dark-border">
        {members.map((m) => (
          <li key={m.userId} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {m.displayName ?? m.userId}
                </p>
                <p className="text-xs capitalize text-muted-foreground">{m.role}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={m.propertyAccessMode === 'all' ? 'primary' : 'secondary'}
                  onClick={() => setMode(m.userId, 'all')}
                >
                  All properties
                </Button>
                <Button
                  size="sm"
                  variant={m.propertyAccessMode === 'selected' ? 'primary' : 'secondary'}
                  onClick={() => setMode(m.userId, 'selected')}
                >
                  Selected properties
                </Button>
                {m.propertyAccessMode === 'selected' ? (
                  <Button
                    size="sm"
                    onClick={() => setExpanded(expanded === m.userId ? null : m.userId)}
                  >
                    {expanded === m.userId ? 'Hide' : 'Manage'}
                  </Button>
                ) : null}
              </div>
            </div>
            {m.propertyAccessMode === 'selected' && expanded === m.userId ? (
              <div className="mt-3">
                <MemberPropertyGrants orgId={orgId} userId={m.userId} properties={properties} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function MemberPropertyGrants({
  orgId,
  userId,
  properties,
}: {
  orgId: string;
  userId: string;
  properties: PropertyOption[];
}) {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState('');
  const [role, setRole] = useState('read_only');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/organizations/${orgId}/members/${userId}/property-access`);
    const body = await res.json();
    setGrants(body.grants ?? []);
  }, [orgId, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const grantedPropertyIds = new Set((grants ?? []).map((g) => g.propertyId));
  const availableProperties = properties.filter((p) => !grantedPropertyIds.has(p.id));

  async function addGrant() {
    if (!propertyId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/organizations/${orgId}/members/${userId}/property-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, propertyRole: role }),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error?.message ?? 'Failed to grant access.');
        return;
      }
      setPropertyId('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function removeGrant(pid: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/organizations/${orgId}/members/${userId}/property-access?propertyId=${pid}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = await res.json();
        setError(body.error?.message ?? 'Failed to revoke access.');
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!grants) {
    return <p className="text-xs text-muted-foreground">Loading property access…</p>;
  }

  return (
    <div className="rounded-lg border border-light-border p-3 dark:border-dark-border">
      {error ? (
        <p className="mb-2 text-xs text-light-danger dark:text-dark-danger">{error}</p>
      ) : null}
      {grants.length === 0 ? (
        <p className="text-xs text-muted-foreground">No properties granted yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {grants.map((g) => (
            <li key={g.propertyId} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-foreground">
                {g.propertyNickname} — {PROPERTY_ROLE_LABELS[g.propertyRole] ?? g.propertyRole}
              </span>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => removeGrant(g.propertyId)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {availableProperties.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block text-xs">
            <span className="text-muted-foreground">Property</span>
            <select
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              className="mt-1 block w-48 rounded-md border border-light-border bg-transparent px-2 py-1.5 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
            >
              <option value="">Select a property…</option>
              {availableProperties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nickname}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 block w-40 rounded-md border border-light-border bg-transparent px-2 py-1.5 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
            >
              {Object.entries(PROPERTY_ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="primary" disabled={busy || !propertyId} onClick={addGrant}>
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}
