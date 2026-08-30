'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { PropertyStatus } from '@propvault/types';
import { Button } from '@/components/ui/Button';

// Property lifecycle pass (WORKLOG.md this date): mirrors the confirm/inline-panel pattern already
// established by OrganizationActionsPanel.tsx (window.confirm for a reversible/less-severe action,
// an inline expand panel with typed confirmation for the one truly irreversible action). Every
// action here is a thin client wrapper -- all real eligibility/role enforcement lives server-side
// (DELETE /api/v1/properties/:id archive route's active-lease check, hard_delete_property()'s own
// principal+owner-level+get_property_deletion_blockers() re-check) so this panel can never be the
// only thing standing between a click and data loss.
interface PropertyActionsPanelProps {
  propertyId: string;
  nickname: string;
  status: PropertyStatus;
  isPrincipal: boolean;
}

export function PropertyActionsPanel({
  propertyId,
  nickname,
  status,
  isPrincipal,
}: PropertyActionsPanelProps) {
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
    fetch(`/api/v1/properties/${propertyId}/deletion-eligibility`)
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled && body.eligible !== undefined) {
          setEligibility({ eligible: body.eligible, blockers: body.blockers ?? [] });
        }
      })
      .catch(() => {
        // Eligibility is a display-only convenience -- if this fails, the Delete section simply
        // stays hidden (eligibility remains null), never falls back to "assume safe".
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, isPrincipal]);

  async function archive() {
    if (!window.confirm(`Archive ${nickname}? It will no longer appear as an active property, but all its history, documents and financial records stay intact and it can be restored later.`)) {
      return;
    }
    setPending('archive');
    setError(null);
    try {
      const response = await fetch(`/api/v1/properties/${propertyId}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to archive property.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to archive property -- check your connection and try again.');
    } finally {
      setPending(null);
    }
  }

  async function restore() {
    if (!window.confirm(`Restore ${nickname} to active?`)) return;
    setPending('restore');
    setError(null);
    try {
      const response = await fetch(`/api/v1/properties/${propertyId}/restore`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to restore property.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to restore property -- check your connection and try again.');
    } finally {
      setPending(null);
    }
  }

  async function hardDelete() {
    if (deleteConfirmText.trim() !== nickname) {
      setError(`Type "${nickname}" exactly to confirm permanent deletion.`);
      return;
    }
    setPending('delete');
    setError(null);
    try {
      const response = await fetch(`/api/v1/properties/${propertyId}/hard-delete`, {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to delete property.');
        return;
      }
      router.push('/properties');
    } catch {
      setError('Failed to delete property -- check your connection and try again.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/properties/${propertyId}/edit`}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3.5 text-[13px] font-semibold text-foreground hover:bg-surface"
      >
        Edit property
      </Link>

      {status === 'active' ? (
        <Button size="sm" disabled={pending !== null} onClick={archive}>
          {pending === 'archive' ? 'Archiving…' : 'Archive property'}
        </Button>
      ) : (
        <Button size="sm" disabled={pending !== null} onClick={restore}>
          {pending === 'restore' ? 'Restoring…' : 'Restore property'}
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
            This property has historical activity and cannot be permanently deleted. Archive it
            instead to keep your records intact.
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
            This permanently deletes {nickname}. This cannot be undone.
          </p>
          <label className="mt-3 block text-xs">
            <span className="text-muted-foreground">
              Type <strong>{nickname}</strong> to confirm
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
              disabled={pending !== null || deleteConfirmText.trim() !== nickname}
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
