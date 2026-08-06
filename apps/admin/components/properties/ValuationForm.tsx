'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// New UI for the optional, manually-captured property valuation (PRODUCT DECISION, 2026-08-04:
// "Keep the Lovable Portfolio Value card... add an optional current estimated value field...
// authorised landlords or staff can manually capture and update it"). Writes through the existing
// PATCH /api/v1/properties/:id route (agent+ RLS-gated, same floor as every other property edit) --
// no new endpoint, no new permission level.
export function ValuationForm({
  propertyId,
  currentValue,
  currentAsOf,
}: {
  propertyId: string;
  currentValue: number | null;
  currentAsOf: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentValue !== null ? String(currentValue) : '');
  const [asOf, setAsOf] = useState(currentAsOf ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const parsedValue = value.trim() === '' ? null : Number(value);
      if (parsedValue !== null && (Number.isNaN(parsedValue) || parsedValue < 0)) {
        setError('Enter a valid, non-negative amount.');
        return;
      }
      const response = await fetch(`/api/v1/properties/${propertyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          estimatedValue: parsedValue,
          estimatedValueAsOf: asOf.trim() === '' ? null : asOf,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to save valuation.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError('Failed to save valuation — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="block text-xs">
        <span className="text-muted-foreground">Estimated value (ZAR)</span>
        <input
          type="number"
          min="0"
          step="1000"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 2500000"
          className="mt-1 block h-9 w-44 rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
        />
      </label>
      <label className="block text-xs">
        <span className="text-muted-foreground">As of</span>
        <input
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          className="mt-1 block h-9 w-40 rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="flex h-9 items-center rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Save valuation'}
      </button>
      {saved ? <p className="text-xs text-success">Saved.</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  );
}
