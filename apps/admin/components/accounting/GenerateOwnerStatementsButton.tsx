'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

function currentMonthBounds(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

// POST /api/v1/owner-statements/draft (API_SPEC.md §6's "month-scoped batch draft") -- generates
// or recomputes a draft statement for every owner with ledger activity in the chosen period.
// Owners who already have an issued/paid statement for that exact period are silently skipped by
// the RPC itself (ACCOUNTING.md §5's frozen-snapshot rule), not by this component.
export function GenerateOwnerStatementsButton({ orgId }: { orgId: string }) {
  const router = useRouter();
  const defaults = currentMonthBounds();
  const [periodStart, setPeriodStart] = useState(defaults.start);
  const [periodEnd, setPeriodEnd] = useState(defaults.end);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/owner-statements/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, periodStart, periodEnd }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to generate owner statements.');
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('Failed to generate owner statements — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        Generate statements
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-light-border p-3 dark:border-dark-border">
      {error ? (
        <p className="w-full text-xs text-light-statusOverdue dark:text-dark-statusOverdue">{error}</p>
      ) : null}
      <label className="text-xs text-light-textSecondary dark:text-dark-textSecondary">
        Period start
        <input
          type="date"
          value={periodStart}
          onChange={(e) => setPeriodStart(e.target.value)}
          className="ml-2 rounded-md border border-light-border bg-transparent px-2 py-1 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
        />
      </label>
      <label className="text-xs text-light-textSecondary dark:text-dark-textSecondary">
        Period end
        <input
          type="date"
          value={periodEnd}
          onChange={(e) => setPeriodEnd(e.target.value)}
          className="ml-2 rounded-md border border-light-border bg-transparent px-2 py-1 text-xs text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
        />
      </label>
      <Button size="sm" disabled={busy} onClick={generate}>
        {busy ? 'Generating…' : 'Generate'}
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
