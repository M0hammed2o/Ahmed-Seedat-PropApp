'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Inspection, InspectionConditionRating, InspectionItem } from '@propvault/types';
import { INSPECTION_CONDITION_RATINGS } from '@propvault/types';
import { INSPECTION_CONDITION_RATING_PRESENTATION } from '@propvault/ui';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';

// Workflow actions for a single inspection (API_SPEC.md §5: items -> sign -> complete), the same
// "this component IS the edit surface, shaped around the real state machine" approach as
// ApplicationActions.tsx -- there is no generic PATCH /api/v1/inspections/:id.

export function InspectionActions({
  inspection,
  items,
  canAct,
}: {
  inspection: Inspection;
  items: InspectionItem[];
  canAct: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signLandlord() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/inspections/${inspection.id}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signer: 'landlord' }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to sign.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to sign — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function signTenant(refusalReason: string | null) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/inspections/${inspection.id}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signer: 'tenant', refusalReason }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to sign.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to sign — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/inspections/${inspection.id}/complete`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to complete inspection.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to complete inspection — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  // Mirrors the API's own completion precondition (inspections/[id]/complete/route.ts) for the
  // Complete button's disabled state -- a UX nicety, not the enforcement; the API/DB CHECK
  // constraint remain the real gate regardless of what this computes.
  const hasBothSignatures = Boolean(inspection.landlordSignedAt) && Boolean(inspection.tenantSignedAt);
  const hasRefusalLogged = Boolean(inspection.landlordSignedAt) && Boolean(inspection.tenantRefusalReason);
  const canComplete = hasBothSignatures || hasRefusalLogged;

  return (
    <div className="mt-6 space-y-4">
      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}

      <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
        <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Items ({items.length})
        </h2>
        <div className="mt-3 space-y-2">
          {items.length === 0 ? (
            <p className="text-xs text-light-textMuted dark:text-dark-textMuted">No items recorded yet.</p>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-md border border-light-border px-3 py-2 text-xs dark:border-dark-border"
              >
                <div>
                  <span className="font-medium text-light-textPrimary dark:text-dark-textPrimary">{item.room}</span>
                  <span className="text-light-textSecondary dark:text-dark-textSecondary"> — {item.itemDescription}</span>
                  {item.notes ? (
                    <p className="mt-0.5 text-light-textMuted dark:text-dark-textMuted">{item.notes}</p>
                  ) : null}
                </div>
                <StatusBadge presentation={INSPECTION_CONDITION_RATING_PRESENTATION[item.conditionRating]} />
              </div>
            ))
          )}
        </div>
        {canAct && inspection.status !== 'completed' ? (
          <AddItemForm inspectionId={inspection.id} setBusy={setBusy} setError={setError} />
        ) : null}
      </div>

      {inspection.status === 'completed' ? (
        <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
          <p className="text-sm text-light-textPrimary dark:text-dark-textPrimary">
            Completed {inspection.completedAt ? new Date(inspection.completedAt).toLocaleString('en-ZA') : ''}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
          <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">Signatures</h2>
          <div className="mt-3 flex flex-wrap gap-6">
            <SignatureRow
              label="Landlord"
              signedAt={inspection.landlordSignedAt}
              canAct={canAct}
              busy={busy}
              onSign={signLandlord}
            />
            <TenantSignatureRow
              signedAt={inspection.tenantSignedAt}
              refusalReason={inspection.tenantRefusalReason}
              canAct={canAct}
              busy={busy}
              onSign={() => signTenant(null)}
              onRefuse={(reason) => signTenant(reason)}
            />
          </div>
          {canAct ? (
            <Button className="mt-4" variant="primary" disabled={busy || !canComplete} onClick={complete}>
              Complete inspection
            </Button>
          ) : null}
          {!canComplete ? (
            <p className="mt-2 text-xs text-light-textMuted dark:text-dark-textMuted">
              Completion requires both signatures, or a landlord signature plus a logged tenant refusal.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SignatureRow({
  label,
  signedAt,
  canAct,
  busy,
  onSign,
}: {
  label: string;
  signedAt: string | null;
  canAct: boolean;
  busy: boolean;
  onSign: () => void;
}) {
  return (
    <div className="text-xs">
      <p className="text-light-textSecondary dark:text-dark-textSecondary">{label}</p>
      {signedAt ? (
        <p className="mt-1 text-light-statusPaid dark:text-dark-statusPaid">
          Signed {new Date(signedAt).toLocaleString('en-ZA')}
        </p>
      ) : canAct ? (
        <Button className="mt-1" size="sm" disabled={busy} onClick={onSign}>
          Sign
        </Button>
      ) : (
        <p className="mt-1 text-light-textMuted dark:text-dark-textMuted">Not yet signed</p>
      )}
    </div>
  );
}

function TenantSignatureRow({
  signedAt,
  refusalReason,
  canAct,
  busy,
  onSign,
  onRefuse,
}: {
  signedAt: string | null;
  refusalReason: string | null;
  canAct: boolean;
  busy: boolean;
  onSign: () => void;
  onRefuse: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  if (signedAt) {
    return (
      <div className="text-xs">
        <p className="text-light-textSecondary dark:text-dark-textSecondary">Tenant</p>
        <p className="mt-1 text-light-statusPaid dark:text-dark-statusPaid">
          Signed {new Date(signedAt).toLocaleString('en-ZA')}
        </p>
      </div>
    );
  }

  if (refusalReason) {
    return (
      <div className="text-xs">
        <p className="text-light-textSecondary dark:text-dark-textSecondary">Tenant</p>
        <p className="mt-1 text-light-statusOverdue dark:text-dark-statusOverdue">Refused: {refusalReason}</p>
      </div>
    );
  }

  return (
    <div className="text-xs">
      <p className="text-light-textSecondary dark:text-dark-textSecondary">Tenant</p>
      {canAct ? (
        <div className="mt-1 flex flex-col gap-2">
          <Button size="sm" disabled={busy} onClick={onSign}>
            Sign
          </Button>
          <div className="flex gap-2">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Refusal reason"
              className="rounded-md border border-light-border bg-transparent px-2 py-1 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
            />
            <Button size="sm" variant="destructive" disabled={busy || !reason} onClick={() => onRefuse(reason)}>
              Log refusal
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-light-textMuted dark:text-dark-textMuted">Not yet signed</p>
      )}
    </div>
  );
}

function AddItemForm({
  inspectionId,
  setBusy,
  setError,
}: {
  inspectionId: string;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [room, setRoom] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [conditionRating, setConditionRating] = useState<InspectionConditionRating>('good');
  const [notes, setNotes] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/inspections/${inspectionId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, itemDescription, conditionRating, notes: notes || null }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to add item.');
        return;
      }
      setRoom('');
      setItemDescription('');
      setNotes('');
      router.refresh();
    } catch {
      setError('Failed to add item — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 grid grid-cols-2 gap-2 border-t border-light-border pt-4 dark:border-dark-border">
      <input
        required
        placeholder="Room"
        value={room}
        onChange={(e) => setRoom(e.target.value)}
        className="rounded-md border border-light-border bg-transparent px-2 py-1 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
      />
      <input
        required
        placeholder="Item description"
        value={itemDescription}
        onChange={(e) => setItemDescription(e.target.value)}
        className="rounded-md border border-light-border bg-transparent px-2 py-1 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
      />
      <select
        value={conditionRating}
        onChange={(e) => setConditionRating(e.target.value as InspectionConditionRating)}
        className="rounded-md border border-light-border bg-transparent px-2 py-1 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
      >
        {INSPECTION_CONDITION_RATINGS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <input
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="rounded-md border border-light-border bg-transparent px-2 py-1 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
      />
      <div className="col-span-2">
        <Button type="submit" size="sm">
          + Add item
        </Button>
      </div>
    </form>
  );
}
