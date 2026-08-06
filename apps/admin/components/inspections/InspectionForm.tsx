'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { InspectionType } from '@propvault/types';
import { INSPECTION_TYPES } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';

// Create-only, same reasoning as ApplicationForm.tsx -- no generic PATCH exists for inspections
// either (API_SPEC.md §5's only mutation endpoints are items/sign/complete, all workflow-shaped,
// handled by InspectionActions on the detail page instead).

interface InspectionFormProps {
  orgId: string;
  propertyId: string;
  unitId: string;
}

export function InspectionForm({ orgId, propertyId, unitId }: InspectionFormProps) {
  const router = useRouter();
  const [inspectionType, setInspectionType] = useState<InspectionType>('routine');
  const [scheduledAt, setScheduledAt] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const response = await fetch('/api/v1/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          propertyId,
          unitId,
          inspectionType,
          scheduledAt: new Date(scheduledAt).toISOString(),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setFieldErrors(body.error?.field_errors ?? {});
        setError(body.error?.message ?? 'Failed to schedule inspection.');
        return;
      }
      router.push(`/inspections/${body.inspection.id}`);
      router.refresh();
    } catch {
      setError('Failed to schedule inspection — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader title="Schedule inspection" />

      <form onSubmit={handleSubmit} className="mt-6 max-w-xl space-y-4">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Inspection type</span>
          <select
            value={inspectionType}
            onChange={(e) => setInspectionType(e.target.value as InspectionType)}
            className={inputClass}
          >
            {INSPECTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Scheduled date/time</span>
          <input
            required
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className={inputClass}
          />
          {fieldErrors.scheduledAt?.length ? (
            <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
              {fieldErrors.scheduledAt[0]}
            </p>
          ) : null}
        </label>

        <div className="flex gap-2 pt-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Schedule inspection'}
          </Button>
          <Button type="button" onClick={() => router.push(`/properties/${propertyId}/units/${unitId}`)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
