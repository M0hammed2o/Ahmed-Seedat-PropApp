'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ExtractionResult, FieldExtractionResult } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

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
    <Panel
      title="Extracted fields (OCR)"
      description="Never applied automatically — always confirmed by a human first."
      actions={
        extractionResult?.reviewedAt ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-light-statusPaid dark:text-dark-statusPaid">
            <span className="h-1.5 w-1.5 rounded-full bg-light-statusPaid dark:bg-dark-statusPaid" />
            Reviewed {new Date(extractionResult.reviewedAt).toLocaleDateString('en-ZA')}
          </span>
        ) : undefined
      }
    >
      {error ? (
        <p className="mb-3 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
          {error}
        </p>
      ) : null}

      {!extractionResult ? (
        canAct ? (
          <>
            <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
              No extraction yet. This never applies fields automatically — you'll review them here
              first.
            </p>
            <Button className="mt-3" size="sm" disabled={busy} onClick={extract}>
              {busy ? 'Extracting…' : 'Extract fields'}
            </Button>
          </>
        ) : (
          <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
            No extraction yet.
          </p>
        )
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-5 text-sm lg:grid-cols-3">
            {Object.entries(FIELD_LABELS).map(([key, label]) => {
              const field = extractionResult.rawProviderOutput[
                key as keyof FieldExtractionResult
              ] as { value: unknown; confidence: number } | undefined;
              if (!field) return null;
              return (
                <div key={key}>
                  <dt className="text-light-textMuted dark:text-dark-textMuted">{label}</dt>
                  <dd className="mt-0.5 flex items-baseline gap-1.5 text-light-textPrimary dark:text-dark-textPrimary">
                    {String(field.value)}
                    <span className="rounded-pill bg-light-surfaceStrong px-1.5 py-0.5 text-[10px] font-medium text-light-textMuted dark:bg-dark-surfaceStrong dark:text-dark-textMuted">
                      {Math.round(field.confidence * 100)}%
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="mt-5 border-t border-light-border pt-4 text-xs text-light-textMuted dark:border-dark-border dark:text-dark-textMuted">
            Overall confidence: {Math.round((extractionResult.overallConfidence ?? 0) * 100)}%
          </p>
          {!extractionResult.reviewedAt ? (
            canAct ? (
              <Button
                className="mt-3"
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={confirmReviewed}
              >
                {busy ? 'Saving…' : 'Confirm reviewed'}
              </Button>
            ) : (
              <p className="mt-2 text-xs text-light-textMuted dark:text-dark-textMuted">
                Not yet reviewed.
              </p>
            )
          ) : null}
        </>
      )}
    </Panel>
  );
}
