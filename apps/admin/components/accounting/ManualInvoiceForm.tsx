'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatSouthAfricanNumber } from '@propvault/utils';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

export interface PropertyOption {
  id: string;
  nickname: string;
}
export interface UnitOption {
  id: string;
  propertyId: string;
  unitLabel: string;
  status: string;
}
export interface TenancyOption {
  unitId: string;
  tenantId: string;
  tenantName: string;
  leaseId: string;
}

interface LineItemDraft {
  description: string;
  quantity: string;
  unitPrice: string;
}

const EMPTY_LINE: LineItemDraft = { description: '', quantity: '1', unitPrice: '' };

function currency(n: number): string {
  return `R${formatSouthAfricanNumber(n)}`;
}

/**
 * Manual (non-rent) tenant invoice creation -- overnight V1 completion pass, Part B. Property
 * filters Unit; Unit filters Tenant (only tenants with a real lease on that unit, current lease
 * resolved server-side in the page). No VAT field -- audited, no tax-rate configuration exists
 * anywhere in the schema yet (organizations.vat_no is a registration number, not a rate), so V1
 * deliberately does not fabricate one.
 */
export interface ManualInvoiceEditContext {
  invoiceId: string;
  invoiceDate: string;
  dueDate: string;
  reference: string;
  description: string;
  notes: string;
  lineItems: LineItemDraft[];
  propertyId: string;
  unitId: string;
  tenantId: string;
  tenantName: string;
}

export function ManualInvoiceForm({
  orgId,
  properties,
  units,
  tenancies,
  editContext,
}: {
  orgId: string;
  properties: PropertyOption[];
  units: UnitOption[];
  tenancies: TenancyOption[];
  /** When set, the form edits this draft invoice in place (PATCH) instead of creating a new one --
   * property/unit/tenant are locked (an invoice's tenancy never changes after creation; that would
   * be a different invoice, not an edit). Overnight V1 completion pass, Part B. */
  editContext?: ManualInvoiceEditContext;
}) {
  const router = useRouter();
  const isEdit = Boolean(editContext);
  const [propertyId, setPropertyId] = useState(editContext?.propertyId ?? '');
  const [unitId, setUnitId] = useState(editContext?.unitId ?? '');
  const [tenantId, setTenantId] = useState(editContext?.tenantId ?? '');
  const [invoiceDate, setInvoiceDate] = useState(editContext?.invoiceDate ?? new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(editContext?.dueDate ?? '');
  const [reference, setReference] = useState(editContext?.reference ?? '');
  const [description, setDescription] = useState(editContext?.description ?? '');
  const [notes, setNotes] = useState(editContext?.notes ?? '');
  const [lines, setLines] = useState<LineItemDraft[]>(editContext?.lineItems ?? [{ ...EMPTY_LINE }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const availableUnits = useMemo(
    () => units.filter((u) => u.propertyId === propertyId && u.status !== 'archived'),
    [units, propertyId],
  );
  const availableTenants = useMemo(
    () => tenancies.filter((t) => t.unitId === unitId),
    [tenancies, unitId],
  );
  const selectedTenancy = availableTenants.find((t) => t.tenantId === tenantId);

  const subtotal = lines.reduce((sum, l) => {
    const qty = Number(l.quantity) || 0;
    const price = Number(l.unitPrice) || 0;
    return sum + qty * price;
  }, 0);

  function updateLine(index: number, patch: Partial<LineItemDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  }
  function removeLine(index: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isEdit && !selectedTenancy) {
      setError('Select a property, unit and tenant.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const lineItemsPayload = lines
        .filter((l) => l.description.trim())
        .map((l) => ({
          description: l.description,
          quantity: Number(l.quantity) || 1,
          unitPrice: Number(l.unitPrice) || 0,
        }));

      const response = isEdit
        ? await fetch(`/api/v1/invoices/${editContext!.invoiceId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              invoiceDate,
              dueDate,
              reference: reference || null,
              description: description || null,
              notes: notes || null,
              lineItems: lineItemsPayload,
            }),
          })
        : await fetch('/api/v1/invoices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orgId,
              leaseId: selectedTenancy!.leaseId,
              tenantId: selectedTenancy!.tenantId,
              invoiceDate,
              dueDate,
              reference: reference || null,
              description: description || null,
              notes: notes || null,
              lineItems: lineItemsPayload,
            }),
          });
      const body = await response.json();
      if (!response.ok) {
        setFieldErrors(body.error?.field_errors ?? {});
        setError(body.error?.message ?? `Failed to ${isEdit ? 'update' : 'create'} invoice.`);
        return;
      }
      const invoiceId = isEdit ? editContext!.invoiceId : body.invoice.id;
      router.push(`/accounting/invoices/${invoiceId}`);
      router.refresh();
    } catch {
      setError(`Failed to ${isEdit ? 'update' : 'create'} invoice -- check your connection and try again.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel className="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}

        {isEdit ? (
          <p className="rounded-md border border-light-border bg-light-surface px-3 py-2 text-xs text-light-textSecondary dark:border-dark-border dark:bg-dark-surface dark:text-dark-textSecondary">
            Tenant: {editContext?.tenantName} — property and tenant cannot be changed once an
            invoice exists.
          </p>
        ) : null}

        <div className={`grid gap-4 sm:grid-cols-3 ${isEdit ? 'hidden' : ''}`}>
          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Property</span>
            <select
              required={!isEdit}
              value={propertyId}
              onChange={(e) => {
                setPropertyId(e.target.value);
                setUnitId('');
                setTenantId('');
              }}
              className={inputClass}
            >
              <option value="">Select…</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nickname}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Unit</span>
            <select
              required={!isEdit}
              value={unitId}
              onChange={(e) => {
                setUnitId(e.target.value);
                setTenantId('');
              }}
              disabled={!propertyId}
              className={inputClass}
            >
              <option value="">{propertyId ? 'Select…' : 'Choose a property first'}</option>
              {availableUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unitLabel}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Tenant</span>
            <select
              required={!isEdit}
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              disabled={!unitId}
              className={inputClass}
            >
              <option value="">{unitId ? 'Select…' : 'Choose a unit first'}</option>
              {availableTenants.map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {t.tenantName}
                </option>
              ))}
            </select>
            {unitId && availableTenants.length === 0 ? (
              <p className="mt-1 text-[11px] text-light-textMuted dark:text-dark-textMuted">
                No tenant has a lease on this unit yet.
              </p>
            ) : null}
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Invoice date</span>
            <input
              required
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Due date</span>
            <input
              required
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={inputClass}
            />
            {fieldErrors.dueDate?.length ? (
              <p className="mt-1 text-light-statusOverdue dark:text-dark-statusOverdue">{fieldErrors.dueDate[0]}</p>
            ) : null}
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Reference (optional)</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Description (optional)</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Water and electricity — August"
              className={inputClass}
            />
          </label>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-light-textPrimary dark:text-dark-textPrimary">
            Line items
          </p>
          <div className="space-y-2">
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-[1fr_5rem_6rem_5rem_auto] items-end gap-2">
                <label className="block text-xs">
                  {i === 0 ? <span className="text-light-textMuted dark:text-dark-textMuted">Description</span> : null}
                  <input
                    value={line.description}
                    onChange={(e) => updateLine(i, { description: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="block text-xs">
                  {i === 0 ? <span className="text-light-textMuted dark:text-dark-textMuted">Qty</span> : null}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.quantity}
                    onChange={(e) => updateLine(i, { quantity: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="block text-xs">
                  {i === 0 ? <span className="text-light-textMuted dark:text-dark-textMuted">Rate</span> : null}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <p className="tabular py-2 text-xs text-light-textPrimary dark:text-dark-textPrimary">
                  {currency((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0))}
                </p>
                <Button type="button" size="sm" onClick={() => removeLine(i)} disabled={lines.length === 1}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" size="sm" className="mt-2" onClick={addLine}>
            + Add line
          </Button>
        </div>

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Notes (optional)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputClass} />
        </label>

        <div className="flex items-center justify-between border-t border-light-border pt-4 dark:border-dark-border">
          <p className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
            Total: {currency(subtotal)}
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={() => router.push('/accounting/invoices')}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Save as draft'}
            </Button>
          </div>
        </div>
      </form>
    </Panel>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
