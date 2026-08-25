'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { PageHeader } from '@/components/ui/PageHeader';

// Lease preparation UI (Phase O, WORKLOG.md 2026-08-25). Generate != Send (Phase S) -- the two are
// always separate explicit actions, never combined into one button.

interface LeaseTemplateSummary {
  id: string;
  name: string;
  mimeType: string;
  status: string;
}

interface LeaseDocumentSummary {
  id: string;
  version: number;
  kind: 'generated' | 'uploaded';
  status: 'draft' | 'issued' | 'superseded';
  originalFileName: string | null;
  createdAt: string;
}

interface LeasePreparationSummary {
  status: 'drafting' | 'reviewed' | 'sent';
  reviewedAt: string | null;
  sentAt: string | null;
  tenantAcknowledgedAt: string | null;
  staffConfirmedSignedAt: string | null;
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';

export function PrepareLeaseClient({
  leaseId,
  orgId,
  leaseStatus,
  rentAmount,
  startDate,
  unitLabel,
  propertyNickname,
}: {
  leaseId: string;
  orgId: string;
  leaseStatus: string;
  rentAmount: number;
  startDate: string | null;
  unitLabel: string;
  propertyNickname: string;
}) {
  const [templates, setTemplates] = useState<LeaseTemplateSummary[]>([]);
  const [documents, setDocuments] = useState<LeaseDocumentSummary[]>([]);
  const [preparation, setPreparation] = useState<LeasePreparationSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [templateId, setTemplateId] = useState('');
  const [approvedOccupants, setApprovedOccupants] = useState('');
  const [parking, setParking] = useState('');
  const [utilities, setUtilities] = useState('');
  const [specialConditions, setSpecialConditions] = useState('');
  const [rentalDueDay, setRentalDueDay] = useState('1');
  const [annualEscalationPct, setAnnualEscalationPct] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  const load = useCallback(async () => {
    const [templatesRes, documentsRes, prepRes] = await Promise.all([
      fetch(`/api/v1/lease-templates?filter[org_id]=${orgId}`),
      fetch(`/api/v1/leases/${leaseId}/documents`),
      fetch(`/api/v1/leases/${leaseId}/prepare`),
    ]);
    const templatesBody = await templatesRes.json();
    const documentsBody = await documentsRes.json();
    const prepBody = await prepRes.json();
    setTemplates((templatesBody.leaseTemplates ?? []).filter((t: LeaseTemplateSummary) => t.status === 'active'));
    setDocuments(documentsBody.leaseDocuments ?? []);
    setPreparation(prepBody.leasePreparation ?? null);
  }, [orgId, leaseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentDocument = documents.find((d) => d.status !== 'superseded') ?? null;

  async function generate() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/leases/${leaseId}/documents/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId,
          approvedOccupants: approvedOccupants || null,
          parking: parking || null,
          utilities: utilities || null,
          specialConditions: specialConditions || null,
          rentalDueDay: rentalDueDay ? Number(rentalDueDay) : null,
          annualEscalationPct: annualEscalationPct ? Number(annualEscalationPct) : null,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        const missing = body.error?.missing_fields as string[] | undefined;
        setError(
          missing?.length
            ? `${body.error.message} Missing: ${missing.join(', ')}.`
            : (body.error?.message ?? 'Could not generate the lease.'),
        );
        return;
      }
      setNotice('Lease generated.');
      setAcknowledged(false);
      await load();
    } catch {
      setError('Failed to generate — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function uploadCompleted(file: File) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch(`/api/v1/leases/${leaseId}/documents`, { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Upload failed.');
        return;
      }
      setNotice('Lease document uploaded.');
      setAcknowledged(false);
      await load();
    } catch {
      setError('Upload failed — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function review() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/leases/${leaseId}/review`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Could not complete the review.');
        return;
      }
      setNotice('Review recorded.');
      await load();
    } catch {
      setError('Failed to review — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/leases/${leaseId}/send`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Could not send the lease.');
        return;
      }
      setNotice(
        body.email?.sent
          ? 'Lease sent — an email notification was delivered to the tenant.'
          : 'Lease sent. (Email notification was not delivered — the tenant may not have an email on file.)',
      );
      await load();
    } catch {
      setError('Failed to send — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmSigned() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/leases/${leaseId}/confirm-signed`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Could not record this.');
        return;
      }
      setNotice('Recorded — a signed copy was received outside the portal.');
      await load();
    } catch {
      setError('Failed — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const canGenerateOrUpload = leaseStatus === 'draft';
  const canReview = canGenerateOrUpload && currentDocument?.status === 'draft' && preparation?.status !== 'reviewed' && preparation?.status !== 'sent';
  const canSend = canGenerateOrUpload && preparation?.status === 'reviewed';
  const alreadySent = preparation?.status === 'sent';
  const canActivate =
    leaseStatus === 'draft' &&
    alreadySent &&
    (preparation?.tenantAcknowledgedAt || preparation?.staffConfirmedSignedAt);

  return (
    <div className="space-y-6 animate-rise">
      <div>
        <Link
          href={`/leases/${leaseId}`}
          className="text-xs text-light-textSecondary hover:underline dark:text-dark-textSecondary"
        >
          ← Back to lease
        </Link>
        <div className="mt-2">
          <PageHeader title={`Prepare lease — ${propertyNickname} ${unitLabel}`} />
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-md border border-light-statusPaid bg-light-statusPaid/10 px-3 py-2 text-xs text-light-statusPaid dark:border-dark-statusPaid dark:bg-dark-statusPaid/10 dark:text-dark-statusPaid">
          {notice}
        </p>
      ) : null}

      {leaseStatus !== 'draft' ? (
        <Panel title="Lease already active">
          <p className="text-sm text-light-textMuted dark:text-dark-textMuted">
            This lease is no longer a draft — preparation is only available before activation.
          </p>
        </Panel>
      ) : null}

      <Panel title="1. Generate from a template, or upload a completed lease">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-xs">
              <span className="text-light-textMuted dark:text-dark-textMuted">Template</span>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputClass}>
                <option value="">Select a template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.mimeType.includes('word') ? '' : '(PDF — manual upload only)'}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              <span className="text-light-textMuted dark:text-dark-textMuted">Approved occupants</span>
              <input value={approvedOccupants} onChange={(e) => setApprovedOccupants(e.target.value)} className={inputClass} />
            </label>
            <label className="block text-xs">
              <span className="text-light-textMuted dark:text-dark-textMuted">Parking</span>
              <input value={parking} onChange={(e) => setParking(e.target.value)} className={inputClass} />
            </label>
            <label className="block text-xs">
              <span className="text-light-textMuted dark:text-dark-textMuted">Utilities</span>
              <input value={utilities} onChange={(e) => setUtilities(e.target.value)} className={inputClass} />
            </label>
          </div>
          <div className="space-y-3">
            <label className="block text-xs">
              <span className="text-light-textMuted dark:text-dark-textMuted">Rent due day</span>
              <input
                type="number"
                min={1}
                max={31}
                value={rentalDueDay}
                onChange={(e) => setRentalDueDay(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-xs">
              <span className="text-light-textMuted dark:text-dark-textMuted">Annual escalation (%)</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={annualEscalationPct}
                onChange={(e) => setAnnualEscalationPct(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-xs">
              <span className="text-light-textMuted dark:text-dark-textMuted">Special conditions</span>
              <textarea
                value={specialConditions}
                onChange={(e) => setSpecialConditions(e.target.value)}
                rows={3}
                className={inputClass}
              />
            </label>
          </div>
        </div>
        <p className="mt-3 text-xs text-light-textMuted dark:text-dark-textMuted">
          Rent R{rentAmount.toLocaleString('en-ZA')} · Start {startDate ?? 'not set'} — edit these on the lease itself
          before generating if they need to change.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button disabled={busy || !canGenerateOrUpload || !templateId} onClick={generate}>
            {busy ? 'Working…' : 'Generate lease draft'}
          </Button>
          <span className="text-xs text-light-textMuted dark:text-dark-textMuted">or</span>
          <label className={canGenerateOrUpload ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}>
            <input
              type="file"
              accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              disabled={busy || !canGenerateOrUpload}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadCompleted(file);
                e.target.value = '';
              }}
            />
            <span className="inline-flex items-center rounded-md border border-light-border px-3 py-2 text-sm font-medium text-light-textPrimary hover:bg-light-surface dark:border-dark-border dark:text-dark-textPrimary dark:hover:bg-dark-surface">
              Upload completed lease
            </span>
          </label>
        </div>
      </Panel>

      <Panel title="2. Document history">
        {documents.length === 0 ? (
          <p className="text-sm text-light-textMuted dark:text-dark-textMuted">No lease document yet.</p>
        ) : (
          <ul className="divide-y divide-light-border dark:divide-dark-border">
            {documents.map((d) => (
              <li key={d.id} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span>
                    v{d.version} — {d.kind} — {d.originalFileName ?? 'lease.docx'}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-light-textMuted dark:text-dark-textMuted">{d.status}</span>
                    <DownloadLink leaseId={leaseId} documentId={d.id} />
                  </span>
                </div>
                {d.kind === 'uploaded' ? (
                  <LeaseOcrSuggestions leaseId={leaseId} leaseDocumentId={d.id} onApplied={load} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="3. Review">
        <label className="flex items-start gap-2 text-sm text-light-textSecondary dark:text-dark-textSecondary">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            disabled={!canReview}
            className="mt-0.5"
          />
          <span>I confirm the lease details are correct and ready to send.</span>
        </label>
        <Button className="mt-3" disabled={busy || !canReview || !acknowledged} onClick={review}>
          Confirm review
        </Button>
        {preparation?.reviewedAt ? (
          <p className="mt-2 text-xs text-light-textMuted dark:text-dark-textMuted">
            Reviewed {new Date(preparation.reviewedAt).toLocaleString('en-ZA')}
          </p>
        ) : null}
      </Panel>

      <Panel title="4. Send to tenant">
        <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
          Sending emails the tenant a secure link to review their lease in the tenant portal.
        </p>
        <Button className="mt-3" disabled={busy || !canSend} onClick={send}>
          {alreadySent ? 'Resend' : 'Send lease'}
        </Button>
        {preparation?.sentAt ? (
          <p className="mt-2 text-xs text-light-textMuted dark:text-dark-textMuted">
            Sent {new Date(preparation.sentAt).toLocaleString('en-ZA')}
          </p>
        ) : null}
      </Panel>

      {alreadySent ? (
        <Panel title="5. Acceptance">
          <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
            This is an acknowledgement of receipt, not a certified electronic signature. The tenant
            can acknowledge in their own portal, or you can record that a signed copy was received
            through another channel.
          </p>
          <div className="mt-3 space-y-1 text-sm text-light-textPrimary dark:text-dark-textPrimary">
            <p>
              Tenant acknowledged:{' '}
              {preparation?.tenantAcknowledgedAt
                ? new Date(preparation.tenantAcknowledgedAt).toLocaleString('en-ZA')
                : 'Not yet'}
            </p>
            <p>
              Staff-confirmed signed copy:{' '}
              {preparation?.staffConfirmedSignedAt
                ? new Date(preparation.staffConfirmedSignedAt).toLocaleString('en-ZA')
                : 'Not yet'}
            </p>
          </div>
          {!preparation?.staffConfirmedSignedAt ? (
            <Button className="mt-3" variant="secondary" disabled={busy} onClick={confirmSigned}>
              Record signed copy received
            </Button>
          ) : null}
          {canActivate ? (
            <p className="mt-3 text-xs text-light-statusPaid dark:text-dark-statusPaid">
              Ready to activate — use the Activate button on the lease page.
            </p>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}

function DownloadLink({ leaseId, documentId }: { leaseId: string; documentId: string }) {
  const [loading, setLoading] = useState(false);
  async function download() {
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/leases/${leaseId}/documents/${documentId}/download`);
      const body = await response.json();
      if (body.signedUrl) window.open(body.signedUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setLoading(false);
    }
  }
  return (
    <button
      type="button"
      onClick={download}
      disabled={loading}
      className="text-xs text-light-accent hover:underline dark:text-dark-accent"
    >
      {loading ? 'Opening…' : 'Download'}
    </button>
  );
}

interface LeaseExtractedField {
  value: string | number;
  confidence: number;
}

const LEASE_OCR_FIELD_TARGETS: { key: string; label: string; patchKey: 'rentAmount' | 'depositAmount' | 'startDate' | 'endDate' }[] = [
  { key: 'rentAmount', label: 'Monthly rent', patchKey: 'rentAmount' },
  { key: 'depositAmount', label: 'Deposit', patchKey: 'depositAmount' },
  { key: 'leaseStartDate', label: 'Start date', patchKey: 'startDate' },
  { key: 'leaseEndDate', label: 'End date', patchKey: 'endDate' },
];

/** Phase 13 (first-tenant-workflow predeploy pass): lease OCR integration -- a manually uploaded
 * completed lease can be scanned for suggested commercial terms, each individually reviewable and
 * appliable (PATCH /api/v1/leases/:id, the same route the lease edit form already uses) -- never
 * auto-applied, matching this codebase's "customer always sees extracted fields in an editable
 * confirmation screen before they're treated as final" rule. */
function LeaseOcrSuggestions({
  leaseId,
  leaseDocumentId,
  onApplied,
}: {
  leaseId: string;
  leaseDocumentId: string;
  onApplied: () => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, LeaseExtractedField> | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState<string | null>(null);

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/leases/${leaseId}/upload-and-parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaseDocumentId }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Could not scan this document.');
        return;
      }
      setFields(body.extraction ?? {});
    } catch {
      setError('Scan failed — check your connection and try again.');
    } finally {
      setScanning(false);
    }
  }

  async function applyField(patchKey: 'rentAmount' | 'depositAmount' | 'startDate' | 'endDate', rawValue: string) {
    const finalValue = edits[patchKey] ?? rawValue;
    setApplying(patchKey);
    try {
      const payload: Record<string, unknown> =
        patchKey === 'rentAmount' || patchKey === 'depositAmount' ? { [patchKey]: Number(finalValue) } : { [patchKey]: finalValue };
      const response = await fetch(`/api/v1/leases/${leaseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) onApplied();
    } finally {
      setApplying(null);
    }
  }

  return (
    <div className="mt-2 rounded-md bg-light-surface p-2 dark:bg-dark-surface">
      <Button type="button" variant="secondary" size="sm" disabled={scanning} onClick={scan}>
        {scanning ? 'Scanning…' : fields ? 'Re-scan' : 'Suggest values from this document'}
      </Button>
      {error ? <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">{error}</p> : null}
      {fields ? (
        <div className="mt-2 space-y-1">
          {LEASE_OCR_FIELD_TARGETS.map(({ key, label, patchKey }) => {
            const field = fields[key];
            if (!field) return null;
            const currentValue = edits[patchKey] ?? String(field.value);
            return (
              <div key={key} className="flex items-center gap-2 text-xs">
                <span className="w-28 shrink-0 text-light-textMuted dark:text-dark-textMuted">{label}</span>
                <input
                  value={currentValue}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [patchKey]: e.target.value }))}
                  className={inputClass + ' mt-0 flex-1'}
                />
                <span className="shrink-0 text-[10px] text-light-textMuted dark:text-dark-textMuted">
                  {Math.round(field.confidence * 100)}%
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={applying === patchKey}
                  onClick={() => void applyField(patchKey, String(field.value))}
                >
                  Apply
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
