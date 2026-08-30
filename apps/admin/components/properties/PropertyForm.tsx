'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Property, PropertyType } from '@propvault/types';
import { PROPERTY_TYPES } from '@propvault/types';
import { PROPERTY_TYPE_LABELS } from '@propvault/ui';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import {
  AddressAutocomplete,
  type AddressSuggestion,
} from '@/components/properties/AddressAutocomplete';

// DESIGN_SYSTEM.md "Forms" -- standard inputs, label above field, inline field_errors sourced
// directly from the API response (never a separately-invented client-side validation message).
// propertyType uses a native <select>, not the segmented-control pattern, since it has 6+ options
// -- over the design system's own stated ≤5 threshold for a segmented control.
//
// Property lifecycle pass (WORKLOG.md this date): renamed from NewPropertyForm.tsx (create-only)
// to also support edit mode, same mode='create'|'edit' shape TenantForm.tsx/UnitForm.tsx already
// use. The PATCH backend (apps/admin/app/api/v1/properties/[id]/route.ts) already existed and
// already enforced RLS/property-scoped-staff permissions -- this is the first UI to actually call
// it for anything beyond the single estimated_value field ValuationForm.tsx already covered.
// `org_id`/`owner_user_id`/`status`/`estimated_value*`/coordinates are deliberately NOT editable
// here: status changes go through the dedicated archive/restore/delete actions (property detail
// page), estimated_value stays ValuationForm's own narrow responsibility, and org_id/owner_user_id
// are not client-settable by the PATCH endpoint at all (confirmed by reading its schema).

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

function toFormState(property?: Property): FormState {
  return {
    nickname: property?.nickname ?? '',
    addressLine1: property?.addressLine1 ?? '',
    addressLine2: property?.addressLine2 ?? '',
    suburb: property?.suburb ?? '',
    city: property?.city ?? '',
    province: property?.province ?? '',
    postalCode: property?.postalCode ?? '',
    propertyType: property?.propertyType ?? 'house',
    municipalAccountNumber: property?.municipalAccountNumber ?? '',
    notes: property?.notes ?? '',
  };
}

interface PropertyFormProps {
  mode: 'create' | 'edit';
  orgId: string;
  property?: Property;
}

export function PropertyForm({ mode, orgId, property }: PropertyFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toFormState(property));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // RELEASE A P0 fix: true when the API rejected the create because the org's plan property limit
  // was reached (`error.upgradeRequired`, apps/admin/app/api/v1/properties/route.ts) -- renders an
  // "Upgrade plan" link instead of leaving the customer at a dead end. Create-mode only -- editing
  // an existing property never hits the plan-limit check.
  const [upgradeRequired, setUpgradeRequired] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function applySuggestion(s: AddressSuggestion) {
    setForm((prev) => ({
      ...prev,
      addressLine1: s.addressLine1,
      suburb: s.suburb ?? prev.suburb,
      city: s.city ?? prev.city,
      province: s.province ?? prev.province,
      postalCode: s.postalCode ?? prev.postalCode,
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    setUpgradeRequired(false);
    try {
      const url = mode === 'create' ? '/api/v1/properties' : `/api/v1/properties/${property!.id}`;
      const basePayload = {
        nickname: form.nickname,
        addressLine1: form.addressLine1,
        addressLine2: form.addressLine2 || null,
        suburb: form.suburb || null,
        city: form.city,
        province: form.province || null,
        postalCode: form.postalCode || null,
        propertyType: form.propertyType,
        municipalAccountNumber: form.municipalAccountNumber || null,
        notes: form.notes || null,
      };
      const payload =
        mode === 'create' ? { orgId, country: 'ZA', ...basePayload } : basePayload;
      const response = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        setFieldErrors(body.error?.field_errors ?? {});
        setError(body.error?.message ?? `Failed to ${mode === 'create' ? 'create' : 'update'} property.`);
        setUpgradeRequired(body.error?.upgradeRequired === true);
        return;
      }
      router.push(`/properties/${body.property.id}`);
      router.refresh();
    } catch {
      setError(`Failed to ${mode === 'create' ? 'create' : 'save'} property -- check your connection and try again.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 animate-rise">
      <PageHeader title={mode === 'create' ? 'Add property' : `Edit ${property?.nickname}`} />

      <Panel className="max-w-xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <div className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
              <p>{error}</p>
              {upgradeRequired ? (
                <a href="/organization/billing" className="mt-1 inline-block font-medium underline">
                  Upgrade plan
                </a>
              ) : null}
            </div>
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
                  {PROPERTY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>

          <AddressAutocomplete onSelect={applySuggestion} />

          <Field label="Address line 1" error={fieldErrors.addressLine1}>
            <input
              required
              value={form.addressLine1}
              onChange={(e) => set('addressLine1', e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Address line 2">
            <input
              value={form.addressLine2}
              onChange={(e) => set('addressLine2', e.target.value)}
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Suburb">
              <input
                value={form.suburb}
                onChange={(e) => set('suburb', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="City" error={fieldErrors.city}>
              <input
                required
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Province">
              <input
                value={form.province}
                onChange={(e) => set('province', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Postal code">
              <input
                value={form.postalCode}
                onChange={(e) => set('postalCode', e.target.value)}
                className={inputClass}
              />
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
              {submitting ? 'Saving…' : mode === 'create' ? 'Create property' : 'Save changes'}
            </Button>
            <Button
              type="button"
              onClick={() => router.push(mode === 'create' ? '/properties' : `/properties/${property!.id}`)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string[];
  children: ReactNode;
}) {
  return (
    <label className="block text-xs">
      <span className="text-light-textMuted dark:text-dark-textMuted">{label}</span>
      {children}
      {error?.length ? (
        <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
          {error[0]}
        </p>
      ) : null}
    </label>
  );
}
