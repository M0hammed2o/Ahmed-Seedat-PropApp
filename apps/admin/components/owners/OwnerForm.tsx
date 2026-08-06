'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Owner, OwnerType } from '@propvault/types';
import { OWNER_TYPES } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';

// Same DESIGN_SYSTEM.md "Forms" conventions as TenantForm.tsx. No `status` field: ownerSchema
// (packages/validation) doesn't expose it, matching the same "server-set only" judgment already
// applied to Tenant/Lease-on-create.

interface FormState {
  ownerType: OwnerType;
  name: string;
  email: string;
  phone: string;
}

function toFormState(owner?: Owner): FormState {
  return {
    ownerType: owner?.ownerType ?? 'individual',
    name: owner?.name ?? '',
    email: owner?.email ?? '',
    phone: owner?.phone ?? '',
  };
}

interface OwnerFormProps {
  mode: 'create' | 'edit';
  orgId: string;
  owner?: Owner;
}

export function OwnerForm({ mode, orgId, owner }: OwnerFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toFormState(owner));
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
      const url = mode === 'create' ? '/api/v1/owners' : `/api/v1/owners/${owner!.id}`;
      const payload =
        mode === 'create'
          ? {
              orgId,
              ownerType: form.ownerType,
              name: form.name,
              email: form.email || null,
              phone: form.phone || null,
            }
          : {
              ownerType: form.ownerType,
              name: form.name,
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
        setError(
          body.error?.message ?? `Failed to ${mode === 'create' ? 'create' : 'update'} owner.`,
        );
        return;
      }
      router.push(`/owners/${body.owner.id}`);
      router.refresh();
    } catch {
      setError('Failed to save owner — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 animate-rise">
      <PageHeader title={mode === 'create' ? 'Add owner' : `Edit ${owner?.name}`} />

      <Panel className="max-w-xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
              {error}
            </p>
          ) : null}

          <Field label="Owner type">
            <select
              value={form.ownerType}
              onChange={(e) => set('ownerType', e.target.value as OwnerType)}
              className={inputClass}
            >
              {OWNER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Name" error={fieldErrors.name}>
            <input
              required
              maxLength={200}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className={inputClass}
              placeholder={
                form.ownerType === 'individual'
                  ? 'e.g. Thabo Mokoena'
                  : 'e.g. Mokoena Properties (Pty) Ltd'
              }
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
              {submitting ? 'Saving…' : mode === 'create' ? 'Create owner' : 'Save changes'}
            </Button>
            <Button
              type="button"
              onClick={() => router.push(mode === 'create' ? '/owners' : `/owners/${owner!.id}`)}
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
