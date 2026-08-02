'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ExtractionResult, FieldExtractionResult } from '@propvault/types';
import { Button } from '@/components/ui/Button';

const SUPPORTED_TYPES = new Set(['bill', 'lease']);

const FIELD_LABELS: Partial<Record<keyof FieldExtractionResult, string>> = {
  supplierName: 'Supplier',
  accountNumber: 'Account number',
  amountDue: 'Amount due',
  dueDate: 'Due date',
  statementDate: 'Statement date',
  invoiceNumber: 'Invoice number',
  paymentReference: 'Payment reference',
  tenantName: 'Tenant name',
  rentAmount: 'Rent amount',
  depositAmount: 'Deposit amount',
  leaseStartDate: 'Lease start date',
  leaseEndDate: 'Lease end date',
  propertyAddress: 'Property address',
};

// OCR review workflow (TASKS.md M20): extract -> view extracted fields (read-only display, this
// is a review/confirmation step, never an edit-and-auto-apply -- DOCUMENT_INTELLIGENCE.md's rule)
// -> a human confirms it's accurate. Only shown for document types the provider actually supports
// (bill/lease); other types never show this panel at all.
export function OcrPanel({
  documentId,
  documentType,
  extractionResult,
  canAct,
}: {
  documentId: string;
  documentType: string;
  extractionResult: ExtractionResult | null;
  canAct: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!SUPPORTED_TYPES.has(documentType)) return null;

  async function extract() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/documents/${documentId}/extract`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to extract fields.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to extract fields — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmReviewed() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/documents/${documentId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to confirm review.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to confirm review — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-light-border p-4 dark:border-dark-border">
      <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Extracted fields (OCR)
      </h2>
      {error ? (
        <p className="mt-2 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">{error}</p>
      ) : null}

      {!extractionResult ? (
        canAct ? (
          <>
            <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
              No extraction yet. This never applies fields automatically — you'll review them here first.
            </p>
            <Button className="mt-2" size="sm" disabled={busy} onClick={extract}>
              {busy ? 'Extracting…' : 'Extract fields'}
            </Button>
          </>
        ) : (
          <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">No extraction yet.</p>
        )
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm lg:grid-cols-3">
            {Object.entries(FIELD_LABELS).map(([key, label]) => {
              const field = extractionResult.rawProviderOutput[key as keyof FieldExtractionResult] as
                | { value: unknown; confidence: number }
                | undefined;
              if (!field) return null;
              return (
                <div key={key}>
                  <dt className="text-light-textMuted dark:text-dark-textMuted">{label}</dt>
                  <dd className="text-light-textPrimary dark:text-dark-textPrimary">
                    {String(field.value)}{' '}
                    <span className="text-[11px] text-light-textMuted dark:text-dark-textMuted">
                      ({Math.round(field.confidence * 100)}%)
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="mt-3 text-xs text-light-textMuted dark:text-dark-textMuted">
            Overall confidence: {Math.round((extractionResult.overallConfidence ?? 0) * 100)}%
          </p>
          {extractionResult.reviewedAt ? (
            <p className="mt-2 text-xs text-light-statusPaid dark:text-dark-statusPaid">
              Reviewed {new Date(extractionResult.reviewedAt).toLocaleString('en-ZA')}
            </p>
          ) : canAct ? (
            <Button className="mt-3" variant="primary" size="sm" disabled={busy} onClick={confirmReviewed}>
              {busy ? 'Saving…' : 'Confirm reviewed'}
            </Button>
          ) : (
            <p className="mt-2 text-xs text-light-textMuted dark:text-dark-textMuted">Not yet reviewed.</p>
          )}
        </>
      )}
    </div>
  );
}
