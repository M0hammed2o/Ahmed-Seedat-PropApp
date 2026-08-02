'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Lease, LeaseStatus } from '@propvault/types';
import { LEASE_STATUSES } from '@propvault/types';
import { Button } from '@/components/ui/Button';

// Same DESIGN_SYSTEM.md "Forms" conventions as UnitForm.tsx/TenantForm.tsx. No unitId field --
// create is always reached from a unit's own context (property/[id]/units/[unitId]/leases/new),
// and leaseUpdateSchema doesn't allow moving a lease to a different unit anyway. No
// rentFrequency field either: RENT_FREQUENCIES currently has exactly one value ('monthly'), a DB
// default, not client-settable (leaseCreateSchema doesn't expose it).

interface FormState {
  startDate: string;
  endDate: string;
  rentAmount: string;
  depositAmount: string;
  status: LeaseStatus;
}

function toFormState(lease?: Lease): FormState {
  return {
    startDate: lease?.startDate ?? '',
    endDate: lease?.endDate ?? '',
    rentAmount: lease?.rentAmount != null ? String(lease.rentAmount) : '',
    depositAmount: lease?.depositAmount != null ? String(lease.depositAmount) : '0',
    status: lease?.status ?? 'draft',
  };
}

interface LeaseFormProps {
  mode: 'create' | 'edit';
  orgId: string;
  unitId: string;
  propertyId: string;
  lease?: Lease;
}

export function LeaseForm({ mode, orgId, unitId, propertyId, lease }: LeaseFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toFormState(lease));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const url = mode === 'create' ? '/api/v1/leases' : `/api/v1/leases/${lease!.id}`;
      const payload =
        mode === 'create'
          ? {
              orgId,
              unitId,
              startDate: form.startDate,
              endDate: form.endDate || null,
              rentAmount: Number(form.rentAmount),
              depositAmount: Number(form.depositAmount || '0'),
            }
          : {
              startDate: form.startDate,
              endDate: form.endDate || null,
              rentAmount: Number(form.rentAmount),
              depositAmount: Number(form.depositAmount || '0'),
              status: form.status,
            };
      const response = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        setFieldErrors(body.error?.field_errors ?? {});
        setError(body.error?.message ?? `Failed to ${mode === 'create' ? 'create' : 'update'} lease.`);
        return;
      }
      router.push(`/leases/${body.lease.id}`);
      router.refresh();
    } catch {
      setError('Failed to save lease — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        {mode === 'create' ? 'Add lease' : 'Edit lease'}
      </h1>

      <form onSubmit={handleSubmit} className="mt-6 max-w-xl space-y-4">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date" error={fieldErrors.startDate}>
            <input
              required
              type="date"
              value={form.startDate}
              onChange={(e) => set('startDate', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="End date (optional)" error={fieldErrors.endDate}>
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => set('endDate', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Rent amount (ZAR)" error={fieldErrors.rentAmount}>
            <input
              required
              type="number"
              min={0}
              step={0.01}
              value={form.rentAmount}
              onChange={(e) => set('rentAmount', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Deposit amount (ZAR)" error={fieldErrors.depositAmount}>
            <input
              type="number"
              min={0}
              step={0.01}
              value={form.depositAmount}
              onChange={(e) => set('depositAmount', e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        {mode === 'edit' ? (
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) => set('status', e.target.value as LeaseStatus)}
              className={inputClass}
            >
              {LEASE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <div className="flex gap-2 pt-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Saving…' : mode === 'create' ? 'Create lease' : 'Save changes'}
          </Button>
          <Button
            type="button"
            onClick={() =>
              router.push(mode === 'create' ? `/properties/${propertyId}/units/${unitId}` : `/leases/${lease!.id}`)
            }
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';

function Field({ label, error, children }: { label: string; error?: string[]; children: ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="text-light-textMuted dark:text-dark-textMuted">{label}</span>
      {children}
      {error?.length ? (
        <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">{error[0]}</p>
      ) : null}
    </label>
  );
}
