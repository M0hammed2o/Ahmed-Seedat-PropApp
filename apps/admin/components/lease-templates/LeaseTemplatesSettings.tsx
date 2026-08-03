'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { LeaseTemplate } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Pill } from '@/components/ui/Pill';

// PWA_V1_COMPLETION_PLAN.md #9: upload, default, replace/archive, version history. "Replace"
// reuses the same upload form with a hidden supersedesId -- the API archives the old row and
// links the new one back to it (never mutates/overwrites the old row, so a lease already created
// against it is untouched).
export function LeaseTemplatesSettings({ orgId, templates }: { orgId: string; templates: LeaseTemplate[] }) {
  const router = useRouter();
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function archive(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/v1/lease-templates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Failed to archive template.');
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function setDefault(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/v1/lease-templates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setDefault: true }),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Failed to set default template.');
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function download(id: string) {
    const response = await fetch(`/api/v1/lease-templates/${id}`);
    const body = await response.json();
    if (response.ok && body.signedUrl) window.open(body.signedUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}

      <UploadForm orgId={orgId} supersedesId={replacingId} onDone={() => setReplacingId(null)} />

      {templates.length === 0 ? (
        <p className="text-sm text-light-textSecondary dark:text-dark-textSecondary">No lease templates yet.</p>
      ) : (
        <Panel className="max-w-2xl !p-0">
          <ul className="divide-y divide-light-border dark:divide-dark-border">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
                    <span className="truncate">{t.name}</span>
                    {t.isDefault ? <Pill tone="primary">Default</Pill> : null}
                  </p>
                  <p className="truncate text-xs text-light-textMuted dark:text-dark-textMuted">{t.originalFileName}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" onClick={() => download(t.id)}>
                    Download
                  </Button>
                  <Button size="sm" onClick={() => setReplacingId(t.id)}>
                    Replace
                  </Button>
                  {!t.isDefault ? (
                    <Button size="sm" disabled={busyId === t.id} onClick={() => setDefault(t.id)}>
                      Make default
                    </Button>
                  ) : null}
                  <Button size="sm" disabled={busyId === t.id} onClick={() => archive(t.id)}>
                    Archive
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function UploadForm({
  orgId,
  supersedesId,
  onDone,
}: {
  orgId: string;
  supersedesId: string | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('orgId', orgId);
      form.set('name', name);
      form.set('isDefault', String(isDefault));
      if (supersedesId) form.set('supersedesId', supersedesId);

      const response = await fetch('/api/v1/lease-templates', { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to upload template.');
        return;
      }
      setName('');
      setIsDefault(false);
      setFile(null);
      onDone();
      router.refresh();
    } catch {
      setError('Failed to upload — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel className="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-3">
        <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          {supersedesId ? 'Replace template' : 'Upload template'}
        </h2>
        {supersedesId ? (
          <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
            The template being replaced will be archived, not deleted — any lease already created from it is
            unaffected.{' '}
            <button type="button" onClick={onDone} className="text-light-accent hover:underline dark:text-dark-accent">
              Cancel replace
            </button>
          </p>
        ) : null}
        {error ? <p className="text-xs text-light-danger dark:text-dark-danger">{error}</p> : null}

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Standard Residential Lease"
            className={inputClass}
          />
        </label>

        <label className="block text-xs">
          <span className="text-light-textMuted dark:text-dark-textMuted">File (PDF or DOCX)</span>
          <input
            required
            type="file"
            accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-light-textPrimary dark:text-dark-textPrimary"
          />
        </label>

        <label className="flex items-center gap-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          Make this the default template
        </label>

        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Uploading…' : supersedesId ? 'Upload replacement' : 'Upload template'}
        </Button>
      </form>
    </Panel>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';
