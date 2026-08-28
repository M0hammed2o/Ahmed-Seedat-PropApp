'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';

interface UnitOption {
  id: string;
  unitLabel: string;
  propertyId: string;
}

// V1 launch-completion pass: property/unit/tenant/vendor/category/notes are all optional manual
// tags (migration 20260101000146) -- purely informational/filterable, not read by either matching
// destination. A minimal standalone evidence uploader is built inline here rather than reusing
// components/documents/DocumentUploadForm.tsx -- that component's `lockedContext` prop assumes
// maintenance-ticket context specifically, and bolting a second, incompatible "shape" onto it
// risked breaking the existing maintenance-ticket upload flow for no real benefit (this form only
// needs one file input, not that component's full category/type/lease picker set).
export function BankTransactionForm({
  orgId,
  bankAccounts,
  properties,
  units,
  tenants,
  vendors,
  evidenceCategoryId,
}: {
  orgId: string;
  bankAccounts: { id: string; bankName: string }[];
  properties: { id: string; nickname: string }[];
  units: UnitOption[];
  tenants: { id: string; fullName: string }[];
  vendors: { id: string; name: string }[];
  /** document_categories.id for 'proof_of_payment' -- used only for the optional evidence
   *  upload below. Null (no upload offered) if that category isn't seeded for some reason. */
  evidenceCategoryId: string | null;
}) {
  const router = useRouter();
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? '');
  const [transactionDate, setTransactionDate] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitsForProperty = useMemo(
    () => units.filter((u) => u.propertyId === propertyId),
    [units, propertyId],
  );

  async function uploadEvidence(): Promise<string | null> {
    if (!evidenceFile || !propertyId || !evidenceCategoryId) return null;
    const form = new FormData();
    form.set('file', evidenceFile);
    form.set('orgId', orgId);
    form.set('propertyId', propertyId);
    form.set('categoryId', evidenceCategoryId);
    form.set('documentType', 'supporting_document');
    if (unitId) form.set('unitId', unitId);
    const response = await fetch('/api/v1/documents', { method: 'POST', body: form });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error?.message ?? 'Failed to upload evidence document.');
    }
    return body.document.id as string;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      let documentId: string | null = null;
      try {
        documentId = await uploadEvidence();
      } catch (uploadErr) {
        setError(
          uploadErr instanceof Error ? uploadErr.message : 'Failed to upload evidence document.',
        );
        return;
      }

      const response = await fetch('/api/v1/bank-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankAccountId,
          transactionDate,
          amount: Number(amount),
          description: description || null,
          reference: reference || null,
          propertyId: propertyId || null,
          unitId: unitId || null,
          tenantId: tenantId || null,
          vendorId: vendorId || null,
          category: category || null,
          documentId,
          notes: notes || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to add transaction.');
        return;
      }
      router.push('/accounting/bank-transactions');
      router.refresh();
    } catch {
      setError('Failed to add transaction — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (bankAccounts.length === 0) {
    return (
      <p className="text-sm text-light-textSecondary dark:text-dark-textSecondary">
        Add a bank account first — transactions must be linked to one.
      </p>
    );
  }

  return (
    <div>
      <PageHeader title="Add transaction" />
      <form onSubmit={handleSubmit} className="mt-6 max-w-xl space-y-4">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Bank account</span>
          <select
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className={inputClass}
          >
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bankName}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Date</span>
          <input
            required
            type="date"
            value={transactionDate}
            onChange={(e) => setTransactionDate(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Amount (ZAR)</span>
          <input
            required
            type="number"
            step={0.01}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Description</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Reference</span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className={inputClass}
          />
        </label>

        <div className="border-t border-light-border pt-4 dark:border-dark-border">
          <p className="mb-3 text-xs font-medium text-light-textSecondary dark:text-dark-textSecondary">
            Optional tags — for filtering and reporting only, not required to save
          </p>

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
              <option value="">Not specified</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nickname}
                </option>
              ))}
            </select>
          </label>

          {propertyId ? (
            <label className="mt-4 block text-xs">
              <span className="text-light-textMuted dark:text-dark-textMuted">Unit</span>
              <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={inputClass}>
                <option value="">Not specified</option>
                {unitsForProperty.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.unitLabel}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="mt-4 block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Tenant</span>
            <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={inputClass}>
              <option value="">Not specified</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-4 block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Vendor</span>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={inputClass}>
              <option value="">Not specified</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-4 block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Category</span>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClass}
              placeholder="e.g. Rent, Utilities, Bank fee"
            />
          </label>

          <label className="mt-4 block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass}
              rows={3}
            />
          </label>

          {evidenceCategoryId ? (
            <label className="mt-4 block text-xs">
              <span className="text-light-textMuted dark:text-dark-textMuted">
                Supporting evidence (PDF, JPEG, PNG, or HEIC){' '}
                {propertyId ? '' : '— choose a property above first'}
              </span>
              <input
                type="file"
                disabled={!propertyId}
                accept="application/pdf,image/jpeg,image/png,image/heic"
                onChange={(e) => setEvidenceFile(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm text-light-textPrimary disabled:opacity-50 dark:text-dark-textPrimary"
              />
            </label>
          ) : null}
        </div>

        <div className="flex gap-2 pt-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Add transaction'}
          </Button>
          <Button type="button" onClick={() => router.push('/accounting/bank-transactions')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
