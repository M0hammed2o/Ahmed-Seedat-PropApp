'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { uploadEvidenceDocument } from '@/lib/uploadEvidenceDocument';

// V1 launch-completion pass: lets an already-created 'pending' expense (created without evidence,
// since ExpenseForm.tsx's upload is optional) have supporting evidence attached later, before it's
// recorded. Uploads via the existing POST /api/v1/documents route, then links the result onto the
// expense via the new POST /api/v1/expenses/:id/attach-evidence route -- never writes document_id
// directly (that route enforces accountant+, 'pending'-only, and same-org document ownership).
export function ExpenseEvidenceUpload({
  expenseId,
  orgId,
  propertyId,
  receiptCategoryId,
}: {
  expenseId: string;
  orgId: string;
  propertyId: string;
  receiptCategoryId: string;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadEvidenceDocument({ orgId, propertyId, categoryId: receiptCategoryId, file });
      if (uploaded.error || !uploaded.documentId) {
        setError(uploaded.error ?? 'Failed to upload evidence.');
        return;
      }

      const response = await fetch(`/api/v1/expenses/${expenseId}/attach-evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: uploaded.documentId }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to attach evidence.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to attach evidence — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 rounded-lg border border-light-border p-4 dark:border-dark-border">
      <p className="text-xs text-light-textSecondary dark:text-dark-textSecondary">
        No supporting evidence attached yet.
      </p>
      {error ? (
        <p className="mt-2 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">{error}</p>
      ) : null}
      <input
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/heic"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="mt-2 block w-full text-sm text-light-textPrimary dark:text-dark-textPrimary"
      />
      <Button className="mt-3" variant="secondary" size="sm" type="submit" disabled={busy}>
        {busy ? 'Uploading…' : 'Attach evidence'}
      </Button>
    </form>
  );
}
