'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OrganizationMemberRole, OrgSeatSummary } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { safeJson } from '@/lib/safeJson';
import { AddStaffMemberForm, type AddStaffMemberResult } from './AddStaffMemberForm';

interface Member {
  userId: string;
  role: OrganizationMemberRole;
  propertyAccessMode: 'all' | 'selected';
  joinedAt: string;
  displayName: string | null;
  propertyCount: number;
}

interface Invite {
  id: string;
  email: string;
  name: string | null;
  role: OrganizationMemberRole;
  propertyAccessMode: 'all' | 'selected';
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

type ProvisionStatus =
  | 'pending'
  | 'pending_send_failed'
  | 'awaiting_activation'
  | 'expired'
  | 'activated'
  | 'revoked';

interface StaffProvision {
  id: string;
  email: string;
  fullName: string | null;
  role: OrganizationMemberRole;
  propertyAccessMode: 'all' | 'selected';
  status: ProvisionStatus;
  expiresAt: string;
  activatedAt: string | null;
  resendCount: number;
  createdAt: string;
}

const PROVISION_STATUS_LABELS: Record<ProvisionStatus, string> = {
  pending: 'Activation pending',
  pending_send_failed: 'Email delivery failed',
  awaiting_activation: 'Activation pending',
  expired: 'Activation link expired',
  activated: 'Active',
  revoked: 'Revoked',
};

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

const ORG_ROLE_LABELS: Record<OrganizationMemberRole, string> = {
  principal: 'Principal',
  manager: 'Manager',
  agent: 'Agent',
  accountant: 'Accountant',
  viewer: 'Viewer',
};

// A manager can only manage roles strictly below manager -- mirrors
// update_organization_member_role()'s own server-side ceiling (20260101000090); this is display
// convenience only, the RPC is the real boundary.
const MANAGER_EDITABLE_ROLES: OrganizationMemberRole[] = ['agent', 'accountant', 'viewer'];

export function StaffAccessPanel({
  orgId,
  properties,
  callerRole,
  seatSummary,
}: {
  orgId: string;
  properties: PropertyOption[];
  callerRole: 'principal' | 'manager';
  seatSummary: OrgSeatSummary;
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [provisions, setProvisions] = useState<StaffProvision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [deliveryNotice, setDeliveryNotice] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const [membersRes, invitesRes, provisionsRes] = await Promise.all([
      fetch(`/api/v1/organizations/${orgId}/members`).then((r) => safeJson(r)),
      fetch(`/api/v1/organizations/${orgId}/invites`).then((r) => safeJson(r)),
      fetch(`/api/v1/organizations/${orgId}/staff-provisions`).then((r) => safeJson(r)),
    ]);
    setMembers(membersRes.members ?? []);
    setInvites((invitesRes.invites ?? []).filter((i: Invite) => !i.acceptedAt && !i.revokedAt));
    // 'activated' provisions are already reflected in the Team list above (provisioning an
    // existing user activates membership immediately) -- only the still-in-flight/terminal states
    // are useful to show in this separate section.
    setProvisions(
      (provisionsRes.provisions ?? []).filter((p: StaffProvision) => p.status !== 'activated'),
    );
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
      const body = await safeJson(res);
      setError(body.error?.message ?? 'Failed to change access mode.');
      return;
    }
    await load();
  }

  async function changeRole(userId: string, role: OrganizationMemberRole) {
    setError(null);
    const res = await fetch(`/api/v1/organizations/${orgId}/members/${userId}/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const body = await safeJson(res);
      setError(body.error?.message ?? 'Failed to change role.');
      return;
    }
    await load();
  }

  async function removeStaff(userId: string, name: string) {
    if (!confirm(`Remove ${name}'s access to this organization?`)) return;
    setError(null);
    const res = await fetch(`/api/v1/organizations/${orgId}/members/${userId}/revoke`, {
      method: 'POST',
    });
    if (!res.ok) {
      const body = await safeJson(res);
      setError(body.error?.message ?? 'Failed to remove staff access.');
      return;
    }
    await load();
  }

  async function resendInvite(id: string) {
    setError(null);
    setDeliveryNotice(null);
    const res = await fetch(`/api/v1/organization-invites/${id}/resend`, { method: 'POST' });
    const body = await safeJson(res);
    if (!res.ok) {
      setError(body.error?.message ?? 'Failed to resend invitation.');
      return;
    }
    setDeliveryNotice(body.emailDeliveryConfigured ?? null);
    await load();
  }

  async function cancelInvite(id: string) {
    if (!confirm('Cancel this invitation?')) return;
    setError(null);
    const res = await fetch(`/api/v1/organization-invites/${id}/revoke`, { method: 'POST' });
    if (!res.ok) {
      const body = await safeJson(res);
      setError(body.error?.message ?? 'Failed to cancel invitation.');
      return;
    }
    await load();
  }

  async function resendProvision(id: string) {
    setError(null);
    setDeliveryNotice(null);
    const res = await fetch(`/api/v1/organizations/${orgId}/staff-provisions/${id}/resend`, {
      method: 'POST',
    });
    const body = await safeJson(res);
    if (!res.ok) {
      setError(body.error?.message ?? 'Failed to resend activation email.');
      return;
    }
    setDeliveryNotice(body.emailDeliveryConfigured ?? null);
    await load();
  }

  async function revokeProvision(id: string) {
    if (!confirm('Revoke this staff activation?')) return;
    setError(null);
    const res = await fetch(`/api/v1/organizations/${orgId}/staff-provisions/${id}/revoke`, {
      method: 'POST',
    });
    if (!res.ok) {
      const body = await safeJson(res);
      setError(body.error?.message ?? 'Failed to revoke this staff activation.');
      return;
    }
    await load();
  }

  const invitableRoles: OrganizationMemberRole[] =
    callerRole === 'principal'
      ? ['manager', 'agent', 'accountant', 'viewer']
      : ['agent', 'accountant', 'viewer'];

  if (!members || !invites || !provisions) {
    return <p className="panel py-8 text-center text-sm text-muted-foreground">Loading staff…</p>;
  }

  return (
    <div className="space-y-4">
      {/* Owner subscription + staff seat entitlement architecture (WORKLOG.md this date): a seat
          belongs to the ORGANIZATION, never the staff member -- only manager+/principal see this
          page at all, so this is never exposed to a staff user themselves. */}
      <p className="rounded-md border border-light-border bg-light-surface px-3 py-2 text-xs text-light-textSecondary dark:border-dark-border dark:bg-dark-surface dark:text-dark-textSecondary">
        {seatSummary.seatLimit === null
          ? `Staff seats: ${seatSummary.activeBillableStaffCount} in use (unlimited on your current plan).`
          : `Staff seats: ${seatSummary.activeBillableStaffCount} of ${seatSummary.seatLimit} used.`}
      </p>

      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}

      {deliveryNotice === false ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          Email delivery is not configured in this environment — no email was sent.
          {'"'}Resend{'"'} once delivery is configured.
        </p>
      ) : deliveryNotice === true ? (
        <p className="rounded-md border border-light-border bg-light-surface px-3 py-2 text-xs text-light-textSecondary dark:border-dark-border dark:bg-dark-surface dark:text-dark-textSecondary">
          Email sent.
        </p>
      ) : null}

      <Panel
        title={`Team (${members.length})`}
        actions={
          !showAddStaff ? (
            <Button size="sm" variant="primary" onClick={() => setShowAddStaff(true)}>
              + Add staff member
            </Button>
          ) : undefined
        }
      >
        <ul className="divide-y divide-light-border dark:divide-dark-border">
          {members.map((m) => {
            const isPrincipal = m.role === 'principal';
            const canEditRole =
              callerRole === 'principal' || MANAGER_EDITABLE_ROLES.includes(m.role);
            return (
              <li key={m.userId} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {m.displayName ?? m.userId}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      {canEditRole ? (
                        <select
                          value={m.role}
                          onChange={(e) =>
                            changeRole(m.userId, e.target.value as OrganizationMemberRole)
                          }
                          className="rounded border border-light-border bg-transparent px-1.5 py-0.5 text-xs text-light-textSecondary dark:border-dark-border dark:text-dark-textSecondary"
                        >
                          {[...new Set([m.role, ...invitableRoles])].map((r) => (
                            <option key={r} value={r}>
                              {ORG_ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs capitalize text-muted-foreground">
                          {ORG_ROLE_LABELS[m.role]}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        ·{' '}
                        {m.propertyAccessMode === 'all'
                          ? 'All properties'
                          : `${m.propertyCount} propert${m.propertyCount === 1 ? 'y' : 'ies'}`}
                        {' · Active'}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant={m.propertyAccessMode === 'all' ? 'primary' : 'secondary'}
                      disabled={isPrincipal}
                      title={
                        isPrincipal ? 'A Principal always retains all-properties access' : undefined
                      }
                      onClick={() => setMode(m.userId, 'all')}
                    >
                      All properties
                    </Button>
                    <Button
                      size="sm"
                      variant={m.propertyAccessMode === 'selected' ? 'primary' : 'secondary'}
                      disabled={isPrincipal}
                      title={
                        isPrincipal ? 'A Principal always retains all-properties access' : undefined
                      }
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
                    {!isPrincipal ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => removeStaff(m.userId, m.displayName ?? 'this member')}
                      >
                        Remove staff access
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
            );
          })}
        </ul>
      </Panel>

      {showAddStaff ? (
        <AddStaffMemberForm
          orgId={orgId}
          properties={properties}
          invitableRoles={invitableRoles}
          onCancel={() => setShowAddStaff(false)}
          onAdded={async (result: AddStaffMemberResult) => {
            setShowAddStaff(false);
            setDeliveryNotice(result.emailDeliveryConfigured);
            await load();
          }}
        />
      ) : null}

      {provisions.length > 0 ? (
        <Panel title={`Staff activations (${provisions.length})`}>
          <ul className="divide-y divide-light-border dark:divide-dark-border">
            {provisions.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {p.fullName ?? p.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.fullName ? `${p.email} · ` : ''}
                    {ORG_ROLE_LABELS[p.role]} ·{' '}
                    {p.propertyAccessMode === 'all' ? 'All properties' : 'Selected properties'} ·{' '}
                    {PROVISION_STATUS_LABELS[p.status]}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {p.status === 'pending_send_failed' ||
                  p.status === 'awaiting_activation' ||
                  p.status === 'expired' ? (
                    <Button size="sm" onClick={() => resendProvision(p.id)}>
                      Resend
                    </Button>
                  ) : null}
                  {p.status !== 'revoked' ? (
                    <Button size="sm" variant="destructive" onClick={() => revokeProvision(p.id)}>
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {invites.length > 0 ? (
        <Panel title={`Pending invitations (${invites.length})`}>
          <ul className="divide-y divide-light-border dark:divide-dark-border">
            {invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {inv.name ?? inv.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {inv.name ? `${inv.email} · ` : ''}
                    {ORG_ROLE_LABELS[inv.role]} ·{' '}
                    {inv.propertyAccessMode === 'all' ? 'All properties' : 'Selected properties'} ·
                    Invitation pending
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => resendInvite(inv.id)}>
                    Resend
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => cancelInvite(inv.id)}>
                    Cancel
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
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
    const body = await safeJson(res);
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
        const body = await safeJson(res);
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
        const body = await safeJson(res);
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
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => removeGrant(g.propertyId)}
              >
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
