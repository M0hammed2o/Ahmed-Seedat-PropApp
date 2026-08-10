'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { OwnerType, OwnerInvitation } from '@propvault/types';
import { OWNER_TYPES } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

// Stage 5: property ownership is part of property setup, not just schema/API (property_owners,
// GET/POST /api/v1/properties/:id/owners already existed and worked -- migration 20260101000022 /
// apps/admin/app/api/v1/properties/[id]/owners/route.ts -- there was simply no UI calling it
// anywhere, confirmed by grep before writing this). The logged-in user is never assumed to be the
// owner -- this panel always requires an explicit pick-or-create action.
//
// Shared-access architecture pass (WORKLOG.md this date): adds account-linking status per owner
// (Invite / Resend / Revoke), backed by owner_invitations (migration 20260101000083). Never links
// an account by email match alone -- every action here goes through the invitation/token RPCs.

interface PropertyOwnerRow {
  ownerId: string;
  ownershipPct: number;
  owner: {
    id: string;
    name: string;
    owner_type: string;
    email: string | null;
    user_id: string | null;
  } | null;
  /** Server-computed (owners/route.ts GET) -- true only when the caller holds manager+ org role
   * and the owner record is unlinked with no email, or an email that matches the caller's own.
   * link_owner_to_self() independently re-checks the same conditions; this only decides whether
   * to render "This is me" instead of "Invite". */
  canSelfLink: boolean;
}

interface OwnerOption {
  id: string;
  name: string;
}

export function PropertyOwnersPanel({
  propertyId,
  orgId,
  canManage,
}: {
  propertyId: string;
  orgId: string;
  canManage: boolean;
}) {
  const [rows, setRows] = useState<PropertyOwnerRow[]>([]);
  const [allOwners, setAllOwners] = useState<OwnerOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [selectedOwnerId, setSelectedOwnerId] = useState('');
  const [pct, setPct] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newOwnerType, setNewOwnerType] = useState<OwnerType>('individual');

  const load = useCallback(async () => {
    const [ownersRes, allOwnersRes] = await Promise.all([
      fetch(`/api/v1/properties/${propertyId}/owners`).then((r) => r.json()),
      fetch(`/api/v1/owners?filter[org_id]=${orgId}`).then((r) => r.json()),
    ]);
    setRows(ownersRes.propertyOwners ?? []);
    setAllOwners(
      (allOwnersRes.owners ?? []).map((o: { id: string; name: string }) => ({
        id: o.id,
        name: o.name,
      })),
    );
    setLoaded(true);
  }, [propertyId, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPct = rows.reduce((sum, r) => sum + Number(r.ownershipPct), 0);
  const unassignedOwners = allOwners.filter((o) => !rows.some((r) => r.ownerId === o.id));

  async function attachOwner(ownerId: string) {
    const response = await fetch(`/api/v1/properties/${propertyId}/owners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId, ownershipPct: Number(pct) }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? 'Failed to attach owner.');
      return false;
    }
    return true;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const pctNum = Number(pct);
    if (!pct || Number.isNaN(pctNum) || pctNum <= 0 || pctNum > 100) {
      setError('Enter an ownership percentage between 0 and 100.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'existing') {
        if (!selectedOwnerId) {
          setError('Select an owner.');
          return;
        }
        const ok = await attachOwner(selectedOwnerId);
        if (!ok) return;
      } else {
        if (!newName.trim()) {
          setError('Enter the new owner’s name.');
          return;
        }
        const createResponse = await fetch('/api/v1/owners', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId,
            ownerType: newOwnerType,
            name: newName,
            email: newEmail || null,
            phone: newPhone || null,
          }),
        });
        const createBody = await createResponse.json();
        if (!createResponse.ok) {
          setError(createBody.error?.message ?? 'Failed to create owner.');
          return;
        }
        const ok = await attachOwner(createBody.owner.id);
        if (!ok) return;
      }
      setSelectedOwnerId('');
      setPct('');
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <p className="panel py-8 text-center text-sm text-muted-foreground">Loading ownership…</p>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <Panel title="Current ownership">
          <ul className="divide-y divide-light-border dark:divide-dark-border">
            {rows.map((r) => (
              <li
                key={r.ownerId}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <span className="min-w-0 truncate text-foreground">
                  {r.owner?.name ?? 'Unknown owner'}
                </span>
                <span className="tabular shrink-0 font-semibold text-foreground">
                  {r.ownershipPct}%
                </span>
                <div className="shrink-0">
                  <OwnerAccountStatus
                    ownerId={r.ownerId}
                    hasAccount={Boolean(r.owner?.user_id)}
                    hasEmail={Boolean(r.owner?.email)}
                    canSelfLink={r.canSelfLink}
                    canManage={canManage}
                    onLinked={load}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p
            className={`mt-3 text-xs ${totalPct === 100 ? 'text-light-statusPaid dark:text-dark-statusPaid' : 'text-light-statusNeedsReview dark:text-dark-statusNeedsReview'}`}
          >
            Total: {totalPct}%{totalPct !== 100 ? ' — ownership shares should add up to 100%.' : ''}
          </p>
        </Panel>
      ) : (
        <p className="panel py-8 text-center text-sm text-muted-foreground">
          No owner recorded for this property yet. The person capturing this information is not
          automatically the owner — add the actual owner below.
        </p>
      )}

      {canManage ? (
        <Panel title="Add an owner">
          <div className="mb-3 flex gap-2">
            <Button
              size="sm"
              variant={mode === 'existing' ? 'primary' : 'secondary'}
              type="button"
              onClick={() => setMode('existing')}
            >
              Select existing owner
            </Button>
            <Button
              size="sm"
              variant={mode === 'new' ? 'primary' : 'secondary'}
              type="button"
              onClick={() => setMode('new')}
            >
              Create new owner
            </Button>
          </div>

          <form onSubmit={submit} className="max-w-md space-y-3">
            {mode === 'existing' ? (
              unassignedOwners.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Every owner in this organization is already attached to this property.
                </p>
              ) : (
                <label className="block text-xs">
                  <span className="text-muted-foreground">Owner</span>
                  <select
                    value={selectedOwnerId}
                    onChange={(e) => setSelectedOwnerId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Select an owner…</option>
                    {unassignedOwners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
              )
            ) : (
              <>
                <label className="block text-xs">
                  <span className="text-muted-foreground">Owner type</span>
                  <select
                    value={newOwnerType}
                    onChange={(e) => setNewOwnerType(e.target.value as OwnerType)}
                    className={inputClass}
                  >
                    {OWNER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t === 'individual' ? 'Individual' : 'Entity / Company'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs">
                  <span className="text-muted-foreground">Name</span>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block text-xs">
                  <span className="text-muted-foreground">Email (optional)</span>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block text-xs">
                  <span className="text-muted-foreground">Phone (optional)</span>
                  <input
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className={inputClass}
                  />
                </label>
              </>
            )}

            <label className="block text-xs">
              <span className="text-muted-foreground">Ownership percentage</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                className={inputClass}
              />
            </label>

            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy ? 'Saving…' : 'Add owner'}
            </Button>
          </form>
        </Panel>
      ) : null}
    </div>
  );
}

/** Per-owner account-link status + Invite/Resend/Revoke -- a self-contained fetch per row (owner
 * counts per property are typically small, so this stays simple rather than restructuring the
 * parent's list fetch to embed invitation history). */
function OwnerAccountStatus({
  ownerId,
  hasAccount,
  hasEmail,
  canSelfLink,
  canManage,
  onLinked,
}: {
  ownerId: string;
  hasAccount: boolean;
  hasEmail: boolean;
  canSelfLink: boolean;
  canManage: boolean;
  onLinked: () => Promise<void>;
}) {
  const [invitations, setInvitations] = useState<OwnerInvitation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCreatedUrl, setJustCreatedUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/owners/${ownerId}/invitations`);
    const body = await res.json();
    setInvitations(body.invitations ?? []);
  }, [ownerId]);

  useEffect(() => {
    if (!hasAccount && !canSelfLink) load();
  }, [hasAccount, canSelfLink, load]);

  if (hasAccount) {
    return (
      <span className="text-xs font-medium text-light-statusPaid dark:text-dark-statusPaid">
        Account linked
      </span>
    );
  }

  async function linkSelf() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/owners/${ownerId}/link-self`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to link this owner record.');
        return;
      }
      await onLinked();
    } finally {
      setBusy(false);
    }
  }

  // Root-cause fix (WORKLOG.md this date): an owner record representing the caller themselves
  // (typically the Principal who set up the org) has no one to email an invitation to -- offer
  // the deliberate self-link action instead of "Invite", never both. link_owner_to_self()
  // re-checks manager+ role and any on-file email match server-side; this button being visible is
  // not itself the security boundary.
  if (canSelfLink) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button size="sm" variant="primary" disabled={busy} onClick={linkSelf}>
          {busy ? 'Linking…' : 'This is me'}
        </Button>
        {error ? (
          <p className="text-[11px] text-light-danger dark:text-dark-danger">{error}</p>
        ) : null}
      </div>
    );
  }

  if (!canManage) {
    return <span className="text-xs text-muted-foreground">Not invited</span>;
  }

  const active = (invitations ?? []).find(
    (i) => !i.acceptedAt && !i.revokedAt && new Date(i.expiresAt) > new Date(),
  );

  async function invite() {
    setBusy(true);
    setError(null);
    setJustCreatedUrl(null);
    try {
      const response = await fetch(`/api/v1/owners/${ownerId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryChannel: hasEmail ? 'email' : 'manual' }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to send invitation.');
        return;
      }
      setJustCreatedUrl(body.acceptUrl ?? null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invitationId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/owner-invitations/${invitationId}/revoke`, {
        method: 'POST',
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Failed to revoke invitation.');
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {active ? 'Invited (pending)' : 'Not invited'}
        </span>
        {active ? (
          <Button size="sm" disabled={busy} onClick={() => revoke(active.id)}>
            Revoke
          </Button>
        ) : null}
        <Button size="sm" disabled={busy} onClick={invite}>
          {active ? 'Resend' : 'Invite'}
        </Button>
      </div>
      {justCreatedUrl ? (
        <p className="max-w-[220px] text-right text-[11px] text-muted-foreground">
          {hasEmail ? 'Sent. ' : ''}Share this link:{' '}
          <a href={justCreatedUrl} className="break-all text-light-accent dark:text-dark-accent">
            {justCreatedUrl}
          </a>
        </p>
      ) : null}
      {error ? (
        <p className="text-[11px] text-light-danger dark:text-dark-danger">{error}</p>
      ) : null}
    </div>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
