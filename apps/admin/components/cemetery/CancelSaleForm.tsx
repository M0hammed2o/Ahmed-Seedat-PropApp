'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ErrorBox, Field, inputClass, sendJson } from '@/components/cemetery/formBits';

/** Cancel a sale / grant of rights: the site returns to Available; payments already received stay on record. */
export function CancelSaleForm({ saleId, label }: { saleId: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await sendJson(`/api/v1/cemetery/sales/${saleId}/cancel`, 'POST', { reason });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button size="sm" variant="destructive" onClick={() => setOpen(true)}>
        Cancel {label}
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-destructive/50 p-4">
      <ErrorBox message={error} />
      <p className="text-xs text-muted-foreground">
        The grave site becomes available again. Payments already received stay on record (retained
        or refunded under your cancellation terms, outside Proplyst). This cannot be undone.
      </p>
      <Field label="Reason for cancellation">
        <input
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={inputClass}
          maxLength={500}
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="destructive" disabled={busy || !reason.trim()}>
          {busy ? 'Cancelling…' : `Confirm cancellation`}
        </Button>
        <Button type="button" size="sm" onClick={() => setOpen(false)}>
          Keep {label}
        </Button>
      </div>
    </form>
  );
}
