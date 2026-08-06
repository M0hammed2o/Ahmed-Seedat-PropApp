'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';

// Create-only -- API_SPEC.md §5 exposes GET/POST /api/v1/announcements and
// POST /:id/acknowledge (tenant-only, no tenant portal in V1, not built), no PATCH/edit at all.
// No property picker: propertyId is optional (org-wide by default) and there's no evidenced
// "target a specific property" UI pattern from PROPVIEW_SCREENSHOT_AUDIT.md to copy, so this
// first slice publishes org-wide only -- a deliberate, disclosed scope reduction, not an oversight.

export function AnnouncementForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [requiresAcknowledgement, setRequiresAcknowledgement] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const response = await fetch('/api/v1/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          title,
          body,
          requiresAcknowledgement,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      const responseBody = await response.json();
      if (!response.ok) {
        setFieldErrors(responseBody.error?.field_errors ?? {});
        setError(responseBody.error?.message ?? 'Failed to publish announcement.');
        return;
      }
      router.push('/announcements');
      router.refresh();
    } catch {
      setError('Failed to publish announcement — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader title="Publish announcement" />

      <form onSubmit={handleSubmit} className="mt-6 max-w-xl space-y-4">
        {error ? (
          <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
            {error}
          </p>
        ) : null}

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Title</span>
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
          />
          {fieldErrors.title?.length ? (
            <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">{fieldErrors.title[0]}</p>
          ) : null}
        </label>

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Body</span>
          <textarea required rows={5} value={body} onChange={(e) => setBody(e.target.value)} className={inputClass} />
          {fieldErrors.body?.length ? (
            <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">{fieldErrors.body[0]}</p>
          ) : null}
        </label>

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Expires (optional)</span>
          <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={inputClass} />
        </label>

        <label className="flex items-center gap-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
          <input
            type="checkbox"
            checked={requiresAcknowledgement}
            onChange={(e) => setRequiresAcknowledgement(e.target.checked)}
          />
          Requires tenant acknowledgement
        </label>

        <div className="flex gap-2 pt-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Publishing…' : 'Publish announcement'}
          </Button>
          <Button type="button" onClick={() => router.push('/announcements')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
