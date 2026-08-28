'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { uploadEvidenceDocument } from '@/lib/uploadEvidenceDocument';

// Create-only (POST /api/v1/expenses always inserts status='pending' -- recording is the separate
// RecordExpenseButton action).
//
// V1 launch-completion pass: extended with unit (cascading off the chosen property, filtered
// client-side exactly like NewApplicationPicker.tsx's own property->unit picker -- this codebase's
// established pattern for "all units across the org, scoped by the currently-selected property"
// rather than a per-keystroke fetch), vendor (existing Vendors module, reused as-is), reference
// number, invoice date, notes, and an optional supporting-evidence upload. Evidence is genuinely
// optional here -- a 'pending' expense may exist with no proof at all (the posting-time evidence
// gate in POST /api/v1/expenses/:id/record/route.ts is what actually enforces accountability, not
// this form).

interface FormOption {
  id: string;
  label: string;
}

interface UnitOption {
  id: string;
  propertyId: string;
  unitLabel: string;
}

interface ExpenseFormProps {
  orgId: string;
  properties: { id: string; nickname: string }[];
  units?: UnitOption[];
  vendors?: FormOption[];
  /** The org's 'receipt' document_categories row -- null only if that seed category is somehow
   *  missing, in which case the evidence upload control is hidden rather than sending a request
   *  guaranteed to fail. */
  receiptCategoryId?: string | null;
}

export function ExpenseForm({
  orgId,
  properties,
  units = [],
  vendors = [],
  receiptCategoryId = null,
}: ExpenseFormProps) {
  const router = useRouter();
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? '');
  const [unitId, setUnitId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitsForProperty = useMemo(
    () => units.filter((u) => u.propertyId === propertyId),
    [units, propertyId],
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      let documentId: string | null = null;
      if (file) {
        if (!receiptCategoryId) {
          setError('Evidence upload is unavailable right now — save the expense without it.');
          return;
        }
        const uploaded = await uploadEvidenceDocument({
          orgId,
          propertyId,
          categoryId: receiptCategoryId,
          file,
        });
        if (uploaded.error) {
          setError(uploaded.error);
          return;
        }
        documentId = uploaded.documentId;
      }

      const response = await fetch('/api/v1/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          propertyId,
          unitId: unitId || null,
          vendorId: vendorId || null,
          category,
          amount: Number(amount),
          documentId,
          referenceNumber: referenceNumber || null,
          invoiceDate: invoiceDate || null,
          notes: notes || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setFieldErrors(body.error?.field_errors ?? {});
        setError(body.error?.message ?? 'Failed to record expense.');
        return;
      }
      router.push(`/accounting/expenses/${body.expense.id}`);
      router.refresh();
    } catch {
      setError('Failed to record expense — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (properties.length === 0) {
    return (
      <p className="text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Add a property first — expenses must be linked to one.
      </p>
    );
  }

  return (
    <div>
      <PageHeader title="Add expense" />

      <form onSubmit={handleSubmit} className="mt-6 max-w-xl space-y-4">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Property</span>
          <select
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value);
              setUnitId('');
            }}
            className={inputClass}
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nickname}
              </option>
            ))}
          </select>
        </label>

        {unitsForProperty.length > 0 ? (
          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Unit — optional</span>
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={inputClass}>
              <option value="">Property-wide (no specific unit)</option>
              {unitsForProperty.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unitLabel}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Category</span>
          <input
            required
            maxLength={100}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
            placeholder="e.g. Plumbing repair"
          />
          {fieldErrors.category?.length ? (
            <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
              {fieldErrors.category[0]}
            </p>
          ) : null}
        </label>

        {vendors.length > 0 ? (
          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Vendor — optional</span>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={inputClass}>
              <option value="">No vendor</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Amount (ZAR)</span>
          <input
            required
            type="number"
            min={0}
            step={0.01}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
          {fieldErrors.amount?.length ? (
            <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
              {fieldErrors.amount[0]}
            </p>
          ) : null}
        </label>

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">
            Reference / invoice number — optional
          </span>
          <input
            maxLength={100}
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
            className={inputClass}
          />
          {fieldErrors.referenceNumber?.length ? (
            <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
              {fieldErrors.referenceNumber[0]}
            </p>
          ) : null}
        </label>

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Invoice date — optional</span>
          <input
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Notes — optional</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            className={inputClass}
          />
        </label>

        {receiptCategoryId ? (
          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">
              Supporting evidence (receipt/invoice) — optional
            </span>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/heic"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm text-light-textPrimary dark:text-dark-textPrimary"
            />
            <p className="mt-1 text-[11px] text-light-textMuted dark:text-dark-textMuted">
              Can also be attached later, before this expense is recorded.
            </p>
          </label>
        ) : null}

        <div className="flex gap-2 pt-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Add expense'}
          </Button>
          <Button type="button" onClick={() => router.push('/accounting/expenses')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
