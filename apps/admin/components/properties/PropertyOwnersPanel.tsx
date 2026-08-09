'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { OwnerType } from '@propvault/types';
import { OWNER_TYPES } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

// Stage 5: property ownership is part of property setup, not just schema/API (property_owners,
// GET/POST /api/v1/properties/:id/owners already existed and worked -- migration 20260101000022 /
// apps/admin/app/api/v1/properties/[id]/owners/route.ts -- there was simply no UI calling it
// anywhere, confirmed by grep before writing this). The logged-in user is never assumed to be the
// owner -- this panel always requires an explicit pick-or-create action.

interface PropertyOwnerRow {
  ownerId: string;
  ownershipPct: number;
  owner: { id: string; name: string; owner_type: string; email: string | null } | null;
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
              <li key={r.ownerId} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-foreground">{r.owner?.name ?? 'Unknown owner'}</span>
                <span className="tabular font-semibold text-foreground">{r.ownershipPct}%</span>
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

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
