'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';

// Create-only -- there is no generic PATCH /api/v1/applications/:id (API_SPEC.md §4 only exposes
// the workflow-shaped consent/screen/decide endpoints, apps/admin/components/applications/
// ApplicationActions.tsx handles those on the detail page). Same DESIGN_SYSTEM.md "Forms"
// conventions as every other create form this pass.

interface FormState {
  applicantName: string;
  applicantEmail: string;
  applicantPhone: string;
}

const EMPTY_STATE: FormState = { applicantName: '', applicantEmail: '', applicantPhone: '' };

interface ApplicationFormProps {
  orgId: string;
  propertyId: string;
  unitId: string;
}

export function ApplicationForm({ orgId, propertyId, unitId }: ApplicationFormProps) {
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
      const response = await fetch('/api/v1/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          propertyId,
          unitId,
          applicantName: form.applicantName,
          applicantEmail: form.applicantEmail || null,
          applicantPhone: form.applicantPhone || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setFieldErrors(body.error?.field_errors ?? {});
        setError(body.error?.message ?? 'Failed to create application.');
        return;
      }
      router.push(`/applications/${body.application.id}`);
      router.refresh();
    } catch {
      setError('Failed to save application — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader title="New application" />

      <form onSubmit={handleSubmit} className="mt-6 max-w-xl space-y-4">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}

        <Field label="Applicant name" error={fieldErrors.applicantName}>
          <input
            required
            maxLength={200}
            value={form.applicantName}
            onChange={(e) => set('applicantName', e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Applicant email" error={fieldErrors.applicantEmail}>
          <input
            type="email"
            value={form.applicantEmail}
            onChange={(e) => set('applicantEmail', e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Applicant phone" error={fieldErrors.applicantPhone}>
          <input
            maxLength={30}
            value={form.applicantPhone}
            onChange={(e) => set('applicantPhone', e.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="flex gap-2 pt-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Create application'}
          </Button>
          <Button
            type="button"
            onClick={() => router.push(`/properties/${propertyId}/units/${unitId}`)}
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
