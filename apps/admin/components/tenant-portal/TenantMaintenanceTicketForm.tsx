'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { MaintenancePriority } from '@propvault/types';
import { Button } from '@/components/ui/Button';

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';

export function TenantMaintenanceTicketForm() {
  const router = useRouter();
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<MaintenancePriority>('medium');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/tenant-portal/maintenance-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary, description: description || null, priority }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to submit request.');
        return;
      }
      router.push('/my-maintenance');
      router.refresh();
    } catch {
      setError('Failed to submit request — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Submit a maintenance request
      </h1>
      <form onSubmit={handleSubmit} className="mt-6 max-w-xl space-y-4">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">What's wrong?</span>
          <input
            required
            maxLength={200}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className={inputClass}
            placeholder="e.g. Kitchen tap leaking"
          />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Details (optional)</span>
          <textarea
            maxLength={5000}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Priority</span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as MaintenancePriority)}
            className={inputClass}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <div className="flex gap-2 pt-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit request'}
          </Button>
          <Button type="button" onClick={() => router.push('/my-maintenance')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
