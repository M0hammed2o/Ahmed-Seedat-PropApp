'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Tenant } from '@propvault/types';
import { Button } from '@/components/ui/Button';

// Same DESIGN_SYSTEM.md "Forms" conventions as NewPropertyForm.tsx/UnitForm.tsx. No `status`
// field -- tenantSchema (packages/validation) deliberately excludes it from client input, it's
// server-set only (defaults 'pending', transitions on lease approval/expiry).

interface FormState {
  fullName: string;
  email: string;
  phone: string;
}

function toFormState(tenant?: Tenant): FormState {
  return {
    fullName: tenant?.fullName ?? '',
    email: tenant?.email ?? '',
    phone: tenant?.phone ?? '',
  };
}

interface TenantFormProps {
  mode: 'create' | 'edit';
  orgId: string;
  tenant?: Tenant;
}

export function TenantForm({ mode, orgId, tenant }: TenantFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toFormState(tenant));
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
      const url = mode === 'create' ? '/api/v1/tenants' : `/api/v1/tenants/${tenant!.id}`;
      const payload =
        mode === 'create'
          ? {
              orgId,
              fullName: form.fullName,
              email: form.email || null,
              phone: form.phone || null,
            }
          : {
              fullName: form.fullName,
              email: form.email || null,
              phone: form.phone || null,
            };
      const response = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        setFieldErrors(body.error?.field_errors ?? {});
        setError(body.error?.message ?? `Failed to ${mode === 'create' ? 'create' : 'update'} tenant.`);
        return;
      }
      router.push(`/tenants/${body.tenant.id}`);
      router.refresh();
    } catch {
      setError('Failed to save tenant — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        {mode === 'create' ? 'Add tenant' : `Edit ${tenant?.fullName}`}
      </h1>

      <form onSubmit={handleSubmit} className="mt-6 max-w-xl space-y-4">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}

        <Field label="Full name" error={fieldErrors.fullName}>
          <input
            required
            maxLength={200}
            value={form.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Email" error={fieldErrors.email}>
          <input
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Phone" error={fieldErrors.phone}>
          <input
            maxLength={30}
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="flex gap-2 pt-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Saving…' : mode === 'create' ? 'Create tenant' : 'Save changes'}
          </Button>
          <Button
            type="button"
            onClick={() => router.push(mode === 'create' ? '/tenants' : `/tenants/${tenant!.id}`)}
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
