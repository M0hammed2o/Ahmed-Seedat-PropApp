'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';

// Levy statement review UI (PHASE 10/11/12, WORKLOG.md this date -- follow-up completing the
// API-only pass from the prior session). Upload -> OCR-assisted extraction (a disclosed heuristic,
// never presented as authoritative) -> human review/correction -> "mark reviewed". Never posts to
// accounting -- every statement's status tops out at "reviewed", and the accounting status is
// always shown explicitly as "Not posted" so there is no ambiguity about what "reviewed" means.

interface LineItem {
  id?: string;
  lineType: 'charge' | 'payment' | 'credit';
  category: string;
  description: string | null;
  amount: number;
  source: 'ocr_heuristic' | 'manual';
  confidence: number | null;
  sortOrder: number;
}

interface Statement {
  id: string;
  status: 'uploaded' | 'extracting' | 'extracted' | 'reviewed';
  statementDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  paymentDueDate: string | null;
  paymentReference: string | null;
  reviewedAt: string | null;
}

const STATUS_LABELS: Record<Statement['status'], string> = {
  uploaded: 'Uploaded',
  extracting: 'Extracting…',
  extracted: 'Extracted — needs review',
  reviewed: 'Reviewed',
};

function statusTone(status: Statement['status']): 'neutral' | 'warning' | 'success' {
  if (status === 'reviewed') return 'success';
  if (status === 'extracted') return 'warning';
  return 'neutral';
}

function currency(n: number): string {
  return `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function LevyStatementsPanel({
  propertyId,
  canManage,
}: {
  propertyId: string;
  canManage: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [extractionWarning, setExtractionWarning] = useState<{
    statementId: string;
    message: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/properties/${propertyId}/levy-statements`);
      const body = await response.json();
      setStatements(body.statements ?? []);
    } catch {
      setError('Could not load levy statements.');
    } finally {
      setLoaded(true);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const categoriesRes = await fetch('/api/v1/document-categories');
      const categoriesBody = await categoriesRes.json();
      const category = (categoriesBody.categories ?? []).find(
        (c: { slug: string }) => c.slug === 'levies',
      );
      if (!category) {
        setError('Levy document category is not available.');
        return;
      }

      const uploadForm = new FormData();
      uploadForm.set('file', file);
      uploadForm.set('propertyId', propertyId);
      uploadForm.set('categoryId', category.id);
      uploadForm.set('documentType', 'statement');
      const uploadRes = await fetch('/api/v1/documents', { method: 'POST', body: uploadForm });
      if (!uploadRes.ok) {
        const body = await uploadRes.json();
        setError(body.error?.message ?? 'Could not upload the statement.');
        return;
      }
      const uploadBody = await uploadRes.json();

      const statementRes = await fetch(`/api/v1/properties/${propertyId}/levy-statements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: uploadBody.document.id }),
      });
      if (!statementRes.ok) {
        const body = await statementRes.json();
        setError(body.error?.message ?? 'Could not record the statement.');
        return;
      }
      const statementBody = await statementRes.json();
      await runExtraction(statementBody.statement.id);

      await load();
      setExpandedId(statementBody.statement.id);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // OCR real-world test readiness pass (WORKLOG.md this date): extraction used to be fired via
  // `.catch(() => {})` with no visible result -- if Document AI threw/timed out, the statement
  // silently ended up back in "Uploaded" status with zero line items and NOTHING on screen told
  // staff extraction failed. Now surfaced as a dismissible warning with a real retry action,
  // matching the failure/retry UX the Documents module's own OcrPanel.tsx already has.
  async function runExtraction(statementId: string) {
    setExtractionWarning(null);
    const fallbackMessage =
      'Automatic extraction failed for this statement -- you can add line items manually below, or retry.';
    try {
      const res = await fetch(`/api/v1/levy-statements/${statementId}/extract`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setExtractionWarning({ statementId, message: body.error?.message ?? fallbackMessage });
      }
    } catch {
      setExtractionWarning({ statementId, message: fallbackMessage });
    }
  }

  async function retryExtraction(statementId: string) {
    await runExtraction(statementId);
    await load();
  }

  if (!loaded) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">Loading levy statements…</p>
    );
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Levy statements</h3>
        {canManage ? (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
              disabled={uploading}
              className="hidden"
              id="levy-statement-upload"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? 'Uploading…' : 'Upload statement'}
            </Button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}

      {extractionWarning ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-light-warning bg-light-warning/10 px-3 py-2 text-xs text-light-warning dark:border-dark-warning dark:bg-dark-warning/10 dark:text-dark-warning">
          <span>{extractionWarning.message}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => retryExtraction(extractionWarning.statementId)}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {statements.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">No levy statements uploaded yet.</p>
      ) : (
        <ul className="space-y-2">
          {statements.map((s) => (
            <li key={s.id} className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                className="flex w-full items-center justify-between gap-3 p-3 text-left"
              >
                <span className="text-sm text-foreground">
                  {s.statementDate ?? 'Statement date not set'}
                  {s.closingBalance !== null
                    ? ` · Closing balance ${currency(s.closingBalance)}`
                    : ''}
                </span>
                <Pill tone={statusTone(s.status)}>{STATUS_LABELS[s.status]}</Pill>
              </button>
              {expandedId === s.id ? (
                <StatementDetail
                  statementId={s.id}
                  status={s.status}
                  canManage={canManage}
                  onChanged={load}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatementDetail({
  statementId,
  status,
  canManage,
  onChanged,
}: {
  statementId: string;
  status: Statement['status'];
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/levy-statements/${statementId}`);
    const body = await response.json();
    setStatement(body.statement ?? null);
    setLineItems(body.lineItems ?? []);
    setLoaded(true);
  }, [statementId]);

  useEffect(() => {
    load();
  }, [load]);

  function updateLine(index: number, patch: Partial<LineItem>) {
    setLineItems((items) => items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function addLine() {
    setLineItems((items) => [
      ...items,
      {
        lineType: 'charge',
        category: 'other',
        description: '',
        amount: 0,
        source: 'manual',
        confidence: null,
        sortOrder: items.length,
      },
    ]);
  }

  function removeLine(index: number) {
    setLineItems((items) => items.filter((_, i) => i !== index));
  }

  async function saveCorrections() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/levy-statements/${statementId}/line-items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineItems: lineItems.map((it, index) => ({
            lineType: it.lineType,
            category: it.category,
            description: it.description,
            amount: it.amount,
            sortOrder: index,
          })),
        }),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Could not save corrections.');
        return;
      }
      await load();
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function markReviewed() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/levy-statements/${statementId}/review`, {
        method: 'POST',
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Could not mark this statement reviewed.');
        return;
      }
      await load();
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  const total = lineItems.reduce(
    (sum, it) => sum + (it.lineType === 'charge' ? it.amount : -it.amount),
    0,
  );

  if (!loaded || !statement) {
    return <p className="border-t border-border p-3 text-sm text-muted-foreground">Loading…</p>;
  }

  const isReviewed = status === 'reviewed';

  return (
    <div className="space-y-3 border-t border-border p-3">
      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}

      <div className="flex items-start gap-2 rounded-md border border-light-statusNeedsReview/30 bg-light-statusNeedsReview/10 px-3 py-2 text-xs text-foreground dark:border-dark-statusNeedsReview/30 dark:bg-dark-statusNeedsReview/10">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Review extracted information before confirming. OCR may contain errors. Nothing here is
          posted to accounting automatically.
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
        <div>
          <dt className="inline">Period: </dt>
          <dd className="inline">
            {statement.periodStart ?? '—'} – {statement.periodEnd ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="inline">Opening balance: </dt>
          <dd className="inline">
            {statement.openingBalance !== null ? currency(statement.openingBalance) : '—'}
          </dd>
        </div>
        <div>
          <dt className="inline">Closing balance: </dt>
          <dd className="inline">
            {statement.closingBalance !== null ? currency(statement.closingBalance) : '—'}
          </dd>
        </div>
        <div>
          <dt className="inline">Payment due: </dt>
          <dd className="inline">{statement.paymentDueDate ?? '—'}</dd>
        </div>
        <div>
          <dt className="inline">Reference: </dt>
          <dd className="inline">{statement.paymentReference ?? '—'}</dd>
        </div>
        <div>
          <dt className="inline">Accounting status: </dt>
          <dd className="inline font-medium text-foreground">Not posted</dd>
        </div>
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-2">Type</th>
              <th className="py-1 pr-2">Category</th>
              <th className="py-1 pr-2">Description</th>
              <th className="py-1 pr-2">Amount</th>
              <th className="py-1 pr-2">Source</th>
              {canManage && !isReviewed ? <th className="py-1 pr-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item, index) => (
              <tr key={item.id ?? index} className="border-t border-border">
                <td className="py-1 pr-2">
                  {canManage && !isReviewed ? (
                    <select
                      value={item.lineType}
                      onChange={(e) =>
                        updateLine(index, { lineType: e.target.value as LineItem['lineType'] })
                      }
                      className="rounded border border-border bg-transparent px-1 py-0.5"
                    >
                      <option value="charge">Charge</option>
                      <option value="payment">Payment</option>
                      <option value="credit">Credit</option>
                    </select>
                  ) : (
                    item.lineType
                  )}
                </td>
                <td className="py-1 pr-2">
                  {canManage && !isReviewed ? (
                    <input
                      value={item.category}
                      onChange={(e) => updateLine(index, { category: e.target.value })}
                      className="w-28 rounded border border-border bg-transparent px-1 py-0.5"
                    />
                  ) : (
                    item.category
                  )}
                </td>
                <td className="py-1 pr-2">
                  {canManage && !isReviewed ? (
                    <input
                      value={item.description ?? ''}
                      onChange={(e) => updateLine(index, { description: e.target.value })}
                      className="w-40 rounded border border-border bg-transparent px-1 py-0.5"
                    />
                  ) : (
                    (item.description ?? '—')
                  )}
                </td>
                <td className="py-1 pr-2">
                  {canManage && !isReviewed ? (
                    <input
                      type="number"
                      step="0.01"
                      value={item.amount}
                      onChange={(e) => updateLine(index, { amount: Number(e.target.value) })}
                      className="w-24 rounded border border-border bg-transparent px-1 py-0.5"
                    />
                  ) : (
                    currency(item.amount)
                  )}
                </td>
                <td className="py-1 pr-2">
                  <Pill tone={item.source === 'manual' ? 'primary' : 'warning'}>
                    {item.source === 'manual' ? 'Manual correction' : 'OCR extracted'}
                  </Pill>
                </td>
                {canManage && !isReviewed ? (
                  <td className="py-1 pr-2">
                    <Button size="sm" variant="destructive" onClick={() => removeLine(index)}>
                      Remove
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Line item total: <span className="font-medium text-foreground">{currency(total)}</span>
      </p>

      {canManage && !isReviewed ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={addLine}>
            Add line item
          </Button>
          <Button size="sm" variant="secondary" disabled={saving} onClick={saveCorrections}>
            {saving ? 'Saving…' : 'Save corrections'}
          </Button>
          <Button size="sm" variant="primary" disabled={saving} onClick={markReviewed}>
            {saving ? 'Saving…' : 'Mark reviewed'}
          </Button>
        </div>
      ) : isReviewed ? (
        <p className="text-xs text-light-statusPaid dark:text-dark-statusPaid">
          Reviewed
          {statement.reviewedAt
            ? ` on ${new Date(statement.reviewedAt).toLocaleDateString('en-ZA')}`
            : ''}
          .
        </p>
      ) : null}
    </div>
  );
}
