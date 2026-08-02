'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { MaintenancePriority, MaintenanceStatus, MaintenanceTicket } from '@propvault/types';
import { MAINTENANCE_PRIORITIES, MAINTENANCE_STATUSES } from '@propvault/types';
import { Button } from '@/components/ui/Button';

// Same DESIGN_SYSTEM.md "Forms" conventions as the other create/edit forms this milestone. No
// unit/lease/tenant/vendor linkage fields -- maintenanceTicketCreateSchema supports them, but
// there's no picker UI for any of them yet (same "don't build a picker for a feature with no real
// caller" judgment as UnitForm/LeaseForm), and vendor assignment specifically has no Vendors
// module UI at all yet (TASKS.md M20 hasn't reached it). Status transitions are NOT
// client-validated against MAINTENANCE_TRANSITIONS (apps/admin/lib/operations.ts is server-only,
// can't be imported here) -- the server rejects an illegal transition with a 409, surfaced through
// the same generic error banner every form in this milestone already has.

interface FormState {
  summary: string;
  description: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
}

function toFormState(ticket?: MaintenanceTicket): FormState {
  return {
    summary: ticket?.summary ?? '',
    description: ticket?.description ?? '',
    priority: ticket?.priority ?? 'medium',
    status: ticket?.status ?? 'to_do',
  };
}

interface MaintenanceFormProps {
  mode: 'create' | 'edit';
  orgId: string;
  propertyId: string;
  ticket?: MaintenanceTicket;
}

export function MaintenanceForm({ mode, orgId, propertyId, ticket }: MaintenanceFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toFormState(ticket));
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
      const url = mode === 'create' ? '/api/v1/maintenance-tickets' : `/api/v1/maintenance-tickets/${ticket!.id}`;
      const payload =
        mode === 'create'
          ? {
              orgId,
              propertyId,
              summary: form.summary,
              description: form.description || null,
              priority: form.priority,
            }
          : {
              summary: form.summary,
              description: form.description || null,
              priority: form.priority,
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
        setError(body.error?.message ?? `Failed to ${mode === 'create' ? 'create' : 'update'} ticket.`);
        return;
      }
      router.push(`/maintenance/${body.maintenanceTicket.id}`);
      router.refresh();
    } catch {
      setError('Failed to save ticket — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        {mode === 'create' ? 'Report an issue' : 'Edit ticket'}
      </h1>

      <form onSubmit={handleSubmit} className="mt-6 max-w-xl space-y-4">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}

        <Field label="Summary" error={fieldErrors.summary}>
          <input
            required
            maxLength={200}
            value={form.summary}
            onChange={(e) => set('summary', e.target.value)}
            className={inputClass}
            placeholder="e.g. Leaking kitchen tap"
          />
        </Field>

        <Field label="Description" error={fieldErrors.description}>
          <textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            rows={4}
            maxLength={5000}
            className={inputClass}
          />
          <p className="mt-1 text-right text-[11px] text-light-textMuted dark:text-dark-textMuted">
            {form.description.length}/5000
          </p>
        </Field>

        <Field label="Priority">
          <select
            value={form.priority}
            onChange={(e) => set('priority', e.target.value as MaintenancePriority)}
            className={inputClass}
          >
            {MAINTENANCE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>

        {mode === 'edit' ? (
          <Field label="Status" error={fieldErrors.status}>
            <select
              value={form.status}
              onChange={(e) => set('status', e.target.value as MaintenanceStatus)}
              className={inputClass}
            >
              {MAINTENANCE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <div className="flex gap-2 pt-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Saving…' : mode === 'create' ? 'Report issue' : 'Save changes'}
          </Button>
          <Button
            type="button"
            onClick={() => router.push(mode === 'create' ? `/properties/${propertyId}` : `/maintenance/${ticket!.id}`)}
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
