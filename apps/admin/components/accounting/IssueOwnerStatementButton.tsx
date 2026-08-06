'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

// POST /api/v1/owner-statements/:id/issue -- freezes the draft (ACCOUNTING.md §5's snapshot rule);
// enforcement lives in issue_owner_statement() regardless of whether this button is shown.
export function IssueOwnerStatementButton({ ownerStatementId }: { ownerStatementId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/owner-statements/${ownerStatementId}/issue`, {
        method: 'POST',
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Failed to issue statement.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to issue statement — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      {error ? (
        <p className="mb-2 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
          {error}
        </p>
      ) : null}
      <Button variant="primary" size="sm" disabled={busy} onClick={issue}>
        {busy ? 'Issuing…' : 'Issue statement'}
      </Button>
    </div>
  );
}
