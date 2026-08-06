'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { DocumentType } from '@propvault/types';
import { DOCUMENT_TYPES } from '@propvault/types';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';

interface DocumentUploadFormProps {
  orgId: string;
  properties: { id: string; nickname: string }[];
  categories: { id: string; label: string }[];
  leases: { id: string; label: string }[];
}

export function DocumentUploadForm({
  orgId,
  properties,
  categories,
  leases,
}: DocumentUploadFormProps) {
  const router = useRouter();
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [documentType, setDocumentType] = useState<DocumentType>('supporting_document');
  const [leaseId, setLeaseId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
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
    setFieldErrors({});
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('orgId', orgId);
      form.set('propertyId', propertyId);
      form.set('categoryId', categoryId);
      form.set('documentType', documentType);
      if (leaseId) form.set('leaseId', leaseId);

      const response = await fetch('/api/v1/documents', { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok) {
        setFieldErrors(body.error?.field_errors ?? {});
        setError(body.error?.message ?? 'Failed to upload document.');
        return;
      }
      router.push(`/documents/${body.document.id}`);
      router.refresh();
    } catch {
      setError('Failed to upload document — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (properties.length === 0) {
    return (
      <div className="space-y-6 animate-rise">
        <PageHeader title="Upload document" />
        <p className="text-sm text-light-textSecondary dark:text-dark-textSecondary">
          Add a property first — documents must be linked to one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-rise">
      <PageHeader title="Upload document" />

      <Panel className="max-w-xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
              {error}
            </p>
          ) : null}

          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">
              File (PDF, JPEG, PNG, or HEIC, up to 25MB)
            </span>
            <input
              required
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/heic"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm text-light-textPrimary dark:text-dark-textPrimary"
            />
            {fieldErrors.file?.length ? (
              <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
                {fieldErrors.file[0]}
              </p>
            ) : null}
          </label>

          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Property</span>
            <select
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              className={inputClass}
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nickname}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Document type</span>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value as DocumentType)}
              className={inputClass}
            >
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Category</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={inputClass}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          {leases.length > 0 ? (
            <label className="block text-xs">
              <span className="text-light-textMuted dark:text-dark-textMuted">
                Tag to a lease (makes this document visible to that tenant) — optional
              </span>
              <select
                value={leaseId}
                onChange={(e) => setLeaseId(e.target.value)}
                className={inputClass}
              >
                <option value="">Not tenant-visible</option>
                {leases.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="flex gap-2 pt-2">
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Uploading…' : 'Upload document'}
            </Button>
            <Button type="button" onClick={() => router.push('/documents')}>
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
