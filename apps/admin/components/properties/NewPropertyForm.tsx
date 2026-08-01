'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { PropertyType } from '@propvault/types';
import { PROPERTY_TYPES } from '@propvault/types';
import { Button } from '@/components/ui/Button';

// DESIGN_SYSTEM.md "Forms" -- standard inputs, label above field, inline field_errors sourced
// directly from the API response (never a separately-invented client-side validation message).
// propertyType uses a native <select>, not the segmented-control pattern, since it has 6 options
// -- over the design system's own stated ≤5 threshold for a segmented control.

interface FormState {
  nickname: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
  propertyType: PropertyType;
  municipalAccountNumber: string;
  notes: string;
}

const EMPTY_STATE: FormState = {
  nickname: '',
  addressLine1: '',
  addressLine2: '',
  suburb: '',
  city: '',
  province: '',
  postalCode: '',
  propertyType: 'house',
  municipalAccountNumber: '',
  notes: '',
};

export function NewPropertyForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_STATE);
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
      const response = await fetch('/api/v1/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          nickname: form.nickname,
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2 || null,
          suburb: form.suburb || null,
          city: form.city,
          province: form.province || null,
          postalCode: form.postalCode || null,
          country: 'ZA',
          propertyType: form.propertyType,
          municipalAccountNumber: form.municipalAccountNumber || null,
          notes: form.notes || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setFieldErrors(body.error?.field_errors ?? {});
        setError(body.error?.message ?? 'Failed to create property.');
        return;
      }
      router.push(`/properties/${body.property.id}`);
    } catch {
      setError('Failed to create property -- check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">Add property</h1>

      <form onSubmit={handleSubmit} className="mt-6 max-w-xl space-y-4">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}

        <Field label="Property name" error={fieldErrors.nickname}>
          <input
            required
            value={form.nickname}
            onChange={(e) => set('nickname', e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Property type">
          <select
            value={form.propertyType}
            onChange={(e) => set('propertyType', e.target.value as PropertyType)}
            className={inputClass}
          >
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace('_', ' ')}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Address line 1" error={fieldErrors.addressLine1}>
          <input
            required
            value={form.addressLine1}
            onChange={(e) => set('addressLine1', e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Address line 2">
          <input value={form.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} className={inputClass} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Suburb">
            <input value={form.suburb} onChange={(e) => set('suburb', e.target.value)} className={inputClass} />
          </Field>
          <Field label="City" error={fieldErrors.city}>
            <input required value={form.city} onChange={(e) => set('city', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Province">
            <input value={form.province} onChange={(e) => set('province', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Postal code">
            <input value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} className={inputClass} />
          </Field>
        </div>

        <Field label="Municipal account number">
          <input
            value={form.municipalAccountNumber}
            onChange={(e) => set('municipalAccountNumber', e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            maxLength={2000}
            className={inputClass}
          />
          <p className="mt-1 text-right text-[11px] text-light-textMuted dark:text-dark-textMuted">
            {form.notes.length}/2000
          </p>
        </Field>

        <div className="flex gap-2 pt-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create property'}
          </Button>
          <Button type="button" onClick={() => router.push('/properties')}>
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
