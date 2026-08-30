'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UnitStatus } from '@propvault/types';
import { Button } from '@/components/ui/Button';

// Unit lifecycle pass (WORKLOG.md this date): same confirm/inline-panel pattern as
// PropertyActionsPanel.tsx. All real enforcement lives server-side (archive_unit()'s own
// active-lease guard, hard_delete_unit()'s own principal+owner-level+
// get_unit_deletion_blockers() re-check) -- this panel is never the only safeguard.
interface UnitActionsPanelProps {
  unitId: string;
  unitLabel: string;
  status: UnitStatus;
  isPrincipal: boolean;
  propertyId: string;
}

export function UnitActionsPanel({
  unitId,
  unitLabel,
  status,
  isPrincipal,
  propertyId,
}: UnitActionsPanelProps) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [eligibility, setEligibility] = useState<{ eligible: boolean; blockers: string[] } | null>(
    null,
  );

  useEffect(() => {
    if (!isPrincipal) return;
    let cancelled = false;
    fetch(`/api/v1/units/${unitId}/deletion-eligibility`)
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled && body.eligible !== undefined) {
          setEligibility({ eligible: body.eligible, blockers: body.blockers ?? [] });
        }
      })
      .catch(() => {
        // Display-only convenience -- a failure keeps the Delete section hidden, never assumes safe.
      });
    return () => {
      cancelled = true;
    };
  }, [unitId, isPrincipal]);

  async function archive() {
    if (
      !window.confirm(
        `Archive Unit ${unitLabel}? It will no longer be available for new tenancy, but stays in historical records and can be restored later.`,
      )
    ) {
      return;
    }
    setPending('archive');
    setError(null);
    try {
      const response = await fetch(`/api/v1/units/${unitId}/archive`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to archive unit.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to archive unit -- check your connection and try again.');
    } finally {
      setPending(null);
    }
  }

  async function restore() {
    if (!window.confirm(`Restore Unit ${unitLabel} to vacant?`)) return;
    setPending('restore');
    setError(null);
    try {
      const response = await fetch(`/api/v1/units/${unitId}/restore`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to restore unit.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to restore unit -- check your connection and try again.');
    } finally {
      setPending(null);
    }
  }

  async function hardDelete() {
    if (deleteConfirmText.trim() !== unitLabel) {
      setError(`Type "${unitLabel}" exactly to confirm permanent deletion.`);
      return;
    }
    setPending('delete');
    setError(null);
    try {
      const response = await fetch(`/api/v1/units/${unitId}/hard-delete`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to delete unit.');
        return;
      }
      router.push(`/properties/${propertyId}`);
    } catch {
      setError('Failed to delete unit -- check your connection and try again.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== 'archived' ? (
        <Button size="sm" disabled={pending !== null} onClick={archive}>
          {pending === 'archive' ? 'Archiving…' : 'Archive unit'}
        </Button>
      ) : (
        <Button size="sm" disabled={pending !== null} onClick={restore}>
          {pending === 'restore' ? 'Restoring…' : 'Restore unit'}
        </Button>
      )}

      {isPrincipal && eligibility?.eligible && !deleteOpen ? (
        <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
          Delete permanently
        </Button>
      ) : null}

      {error ? (
        <p className="w-full rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}

      {isPrincipal && eligibility && !eligibility.eligible ? (
        <div className="w-full text-[12px] text-muted-foreground">
          <p>
            This unit has historical activity and cannot be permanently deleted. Archive it
            instead to keep its records intact.
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {eligibility.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {deleteOpen ? (
        <div className="mt-2 w-full rounded-xl border border-light-danger bg-light-danger/5 p-4 dark:border-dark-danger dark:bg-dark-danger/5">
          <p className="text-[13px] font-semibold text-light-danger dark:text-dark-danger">
            This permanently deletes Unit {unitLabel}. This cannot be undone.
          </p>
          <label className="mt-3 block text-xs">
            <span className="text-muted-foreground">
              Type <strong>{unitLabel}</strong> to confirm
            </span>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              className="mt-1 block w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={pending !== null || deleteConfirmText.trim() !== unitLabel}
              onClick={hardDelete}
            >
              {pending === 'delete' ? 'Deleting…' : 'Delete permanently'}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setDeleteOpen(false);
                setDeleteConfirmText('');
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
