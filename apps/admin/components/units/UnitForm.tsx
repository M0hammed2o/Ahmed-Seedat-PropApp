'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Unit, UnitStatus } from '@propvault/types';
import { UNIT_STATUSES } from '@propvault/types';
import { Button } from '@/components/ui/Button';

// Same DESIGN_SYSTEM.md "Forms" conventions as NewPropertyForm.tsx: label above field, inline
// field_errors sourced from the API response, native <select> for status (3 options, under the
// design system's ≤5 segmented-control threshold anyway but a select reads clearer paired with a
// label here than a 3-way segmented control would for an optional field).

interface FormState {
  unitLabel: string;
  bedrooms: string;
  bathrooms: string;
  sizeSqm: string;
  marketRent: string;
  status: UnitStatus;
}

function toFormState(unit?: Unit): FormState {
  return {
    unitLabel: unit?.unitLabel ?? '',
    bedrooms: unit?.bedrooms != null ? String(unit.bedrooms) : '',
    bathrooms: unit?.bathrooms != null ? String(unit.bathrooms) : '',
    sizeSqm: unit?.sizeSqm != null ? String(unit.sizeSqm) : '',
    marketRent: unit?.marketRent != null ? String(unit.marketRent) : '',
    status: unit?.status ?? 'vacant',
  };
}

function toPayload(form: FormState) {
  return {
    unitLabel: form.unitLabel,
    bedrooms: form.bedrooms === '' ? null : Number(form.bedrooms),
    bathrooms: form.bathrooms === '' ? null : Number(form.bathrooms),
    sizeSqm: form.sizeSqm === '' ? null : Number(form.sizeSqm),
    marketRent: form.marketRent === '' ? null : Number(form.marketRent),
    status: form.status,
  };
}

interface UnitFormProps {
  mode: 'create' | 'edit';
  propertyId: string;
  unit?: Unit;
}

export function UnitForm({ mode, propertyId, unit }: UnitFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toFormState(unit));
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
      const url =
        mode === 'create' ? `/api/v1/properties/${propertyId}/units` : `/api/v1/units/${unit!.id}`;
      const response = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toPayload(form)),
      });
      const body = await response.json();
      if (!response.ok) {
        setFieldErrors(body.error?.field_errors ?? {});
        setError(body.error?.message ?? `Failed to ${mode === 'create' ? 'create' : 'update'} unit.`);
        return;
      }
      router.push(`/properties/${propertyId}/units/${body.unit.id}`);
      router.refresh();
    } catch {
      setError('Failed to save unit — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        {mode === 'create' ? 'Add unit' : `Edit ${unit?.unitLabel}`}
      </h1>

      <form onSubmit={handleSubmit} className="mt-6 max-w-xl space-y-4">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}

        <Field label="Unit label" error={fieldErrors.unitLabel}>
          <input
            required
            maxLength={60}
            value={form.unitLabel}
            onChange={(e) => set('unitLabel', e.target.value)}
            className={inputClass}
            placeholder="e.g. Unit 4B"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Bedrooms" error={fieldErrors.bedrooms}>
            <input
              type="number"
              min={0}
              max={50}
              value={form.bedrooms}
              onChange={(e) => set('bedrooms', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Bathrooms" error={fieldErrors.bathrooms}>
            <input
              type="number"
              min={0}
              max={50}
              step={0.5}
              value={form.bathrooms}
              onChange={(e) => set('bathrooms', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Size (m²)" error={fieldErrors.sizeSqm}>
            <input
              type="number"
              min={0}
              step={0.01}
              value={form.sizeSqm}
              onChange={(e) => set('sizeSqm', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Market rent (ZAR)" error={fieldErrors.marketRent}>
            <input
              type="number"
              min={0}
              step={0.01}
              value={form.marketRent}
              onChange={(e) => set('marketRent', e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Status">
          <select
            value={form.status}
            onChange={(e) => set('status', e.target.value as UnitStatus)}
            className={inputClass}
          >
            {UNIT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex gap-2 pt-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Saving…' : mode === 'create' ? 'Create unit' : 'Save changes'}
          </Button>
          <Button
            type="button"
            onClick={() =>
              router.push(
                mode === 'create' ? `/properties/${propertyId}` : `/properties/${propertyId}/units/${unit!.id}`,
              )
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
