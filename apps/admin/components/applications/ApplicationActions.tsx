'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Application } from '@propvault/types';
import { applicationDisplayPresentation } from '@propvault/ui';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';

// V1-simplified workflow action panel (DECISIONS.md 2026-08-01): New -> Reviewing (implicit, on
// first note save) -> Approve/Decline/Withdraw. Screening (consent + provider call) is deferred
// to ROADMAP.md and deliberately not surfaced here -- see the removed screening UI's history in
// git log if that work is ever resumed. POPIA consent is the only consent capture kept, per the
// "basic privacy consent where personal information is collected" V1 requirement.

export function ApplicationActions({
  application,
  canAct,
}: {
  application: Application;
  canAct: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function recordPopiaConsent() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/applications/${application.id}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ popiaConsent: true }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to record consent.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to record consent — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/applications/${application.id}/withdraw`, {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to withdraw application.');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to withdraw application — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const isFinal = application.status === 'decided' || application.status === 'withdrawn';

  if (isFinal) {
    return (
      <div className="mt-6 space-y-4">
        <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
          <StatusBadge presentation={applicationDisplayPresentation(application)} />
          {application.status === 'decided' ? (
            <>
              <p className="mt-2 text-xs text-light-textMuted dark:text-dark-textMuted">
                {application.decisionReason ? `${application.decisionReason} — ` : ''}
                {application.decidedAt
                  ? new Date(application.decidedAt).toLocaleString('en-ZA')
                  : ''}
              </p>
            </>
          ) : null}
        </div>
        {application.notes ? <NotesDisplay notes={application.notes} /> : null}
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {error ? (
        <p className="rounded-md border border-light-danger bg-light-danger/10 px-3 py-2 text-xs text-light-danger dark:border-dark-danger dark:bg-dark-danger/10 dark:text-dark-danger">
          {error}
        </p>
      ) : null}

      <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
        <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
          Privacy (POPIA) consent
        </h2>
        <div className="mt-3">
          {application.popiaConsentAt ? (
            <span className="text-xs text-light-statusPaid dark:text-dark-statusPaid">
              Granted {new Date(application.popiaConsentAt).toLocaleDateString('en-ZA')}
            </span>
          ) : canAct ? (
            <Button size="sm" disabled={busy} onClick={recordPopiaConsent}>
              Record consent
            </Button>
          ) : (
            <span className="text-xs text-light-textMuted dark:text-dark-textMuted">
              Not yet granted
            </span>
          )}
        </div>
      </div>

      <NotesPanel
        applicationId={application.id}
        notes={application.notes}
        canAct={canAct}
        onSaved={() => router.refresh()}
      />

      <InvitationPanel application={application} canAct={canAct} />

      {canAct ? (
        <>
          <DocumentRequirementsPanel applicationId={application.id} />
          <DecisionPanel
            applicationId={application.id}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
          />
          <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
            <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
              Withdraw
            </h2>
            <p className="mt-1 text-xs text-light-textMuted dark:text-dark-textMuted">
              Record that the applicant pulled out, without approving or declining.
            </p>
            <Button
              className="mt-2"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={withdraw}
            >
              Withdraw application
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function NotesDisplay({ notes }: { notes: string }) {
  return (
    <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
      <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Notes
      </h2>
      <p className="mt-2 whitespace-pre-wrap text-sm text-light-textSecondary dark:text-dark-textSecondary">
        {notes}
      </p>
    </div>
  );
}

function NotesPanel({
  applicationId,
  notes,
  canAct,
  onSaved,
}: {
  applicationId: string;
  notes: string | null;
  canAct: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/applications/${applicationId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: value }),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error?.message ?? 'Failed to save notes.');
        return;
      }
      onSaved();
    } catch {
      setError('Failed to save notes — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
      <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Notes
      </h2>
      {error ? (
        <p className="mt-1 text-xs text-light-statusOverdue dark:text-dark-statusOverdue">
          {error}
        </p>
      ) : null}
      {canAct ? (
        <>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            maxLength={5000}
            placeholder="Notes from reviewing the applicant and their documents…"
            className="mt-2 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
          />
          <Button className="mt-2" size="sm" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save notes'}
          </Button>
        </>
      ) : notes ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-light-textSecondary dark:text-dark-textSecondary">
          {notes}
        </p>
      ) : (
        <p className="mt-2 text-xs text-light-textMuted dark:text-dark-textMuted">No notes yet.</p>
      )}
    </div>
  );
}

function DecisionPanel({
  applicationId,
  busy,
  setBusy,
  setError,
}: {
  applicationId: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'approve' | 'decline'>('approve');
  const [reason, setReason] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload =
        mode === 'approve' ? { decision: 'approved' } : { decision: 'declined', reason: reason || null };
      const response = await fetch(`/api/v1/applications/${applicationId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to record decision.');
        return;
      }
      if (mode === 'approve' && body.leaseId) {
        // Approval only creates a DRAFT lease -- commercial terms are entered next, on the lease
        // itself, via the existing lease edit screen (no active lease/occupancy happens yet).
        router.push(`/leases/${body.leaseId}/edit`);
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to record decision — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
      <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Decision
      </h2>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant={mode === 'approve' ? 'primary' : 'secondary'}
          type="button"
          onClick={() => setMode('approve')}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant={mode === 'decline' ? 'destructive' : 'secondary'}
          type="button"
          onClick={() => setMode('decline')}
        >
          Decline
        </Button>
      </div>

      <form onSubmit={submit} className="mt-4 max-w-md space-y-3">
        {mode === 'approve' ? (
          <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
            Approving links this applicant to a tenant and creates a draft lease. The unit is not
            marked occupied and no rent is charged until you finish preparing and activating the
            lease.
          </p>
        ) : (
          <label className="block text-xs">
            <span className="text-light-textMuted dark:text-dark-textMuted">Reason (optional)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className={inputClass}
            />
          </label>
        )}

        <Button
          type="submit"
          variant={mode === 'approve' ? 'primary' : 'destructive'}
          disabled={busy}
        >
          {busy ? 'Saving…' : mode === 'approve' ? 'Approve application' : 'Decline application'}
        </Button>
      </form>
    </div>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary';

interface AccessTokenStatus {
  deliveryChannel: 'email' | 'whatsapp' | 'manual';
  destinationHint: string | null;
  expiresAt: string;
  lastAccessedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  isCurrent: boolean;
}

// Launch-hardening pass (WORKLOG.md 2026-08-26), Section 2: previously nothing in the UI ever
// called POST .../access-tokens (the only place a token is created and an invitation email
// dispatched) -- every application created through the real product UI silently never invited its
// applicant. This panel is the fix: shows real, derived invitation status (never invited / sent /
// opened / expired / delivery not configured) and wires Invite/Resend to the existing, already-
// correct route -- no new backend logic, just making an orphaned capability reachable.
function InvitationPanel({ application, canAct }: { application: Application; canAct: boolean }) {
  const [status, setStatus] = useState<{
    accessToken: AccessTokenStatus | null;
    email: { status: string } | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadStatus() {
    try {
      const response = await fetch(`/api/v1/applications/${application.id}/access-tokens`);
      const body = await response.json();
      setStatus(response.ok ? body : { accessToken: null, email: null });
    } catch {
      setStatus({ accessToken: null, email: null });
    }
  }

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [application.id]);

  async function invite(isResend: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/applications/${application.id}/access-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryChannel: 'email',
          destinationHint: application.applicantEmail ?? undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Failed to send invitation.');
        return;
      }
      if (body.email && body.email.deliveryConfigured === false) {
        setNotice(
          'Invitation link created, but no real email provider is configured in this environment — nothing was actually sent.',
        );
      } else if (body.email?.sent) {
        setNotice(isResend ? 'Invitation resent.' : 'Invitation sent.');
      } else {
        setNotice(
          'Invitation link created, but the email could not be queued — check the applicant has a valid email address on file.',
        );
      }
      await loadStatus();
    } catch {
      setError('Failed — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (status === null) return null;

  const token = status.accessToken;
  const hasEmail = Boolean(application.applicantEmail);
  const expired = token ? new Date(token.expiresAt).getTime() < Date.now() : false;
  const emailFailed = status.email?.status === 'failed' || status.email?.status === 'bounced';

  let label: string;
  let tone: 'muted' | 'success' | 'warning' | 'danger';
  if (!token) {
    label = 'Not yet invited';
    tone = 'muted';
  } else if (token.revokedAt && token.isCurrent === false) {
    label = 'Previous invitation replaced';
    tone = 'muted';
  } else if (expired) {
    label = 'Invitation link expired';
    tone = 'warning';
  } else if (emailFailed) {
    label = 'Invitation email failed to send';
    tone = 'danger';
  } else if (token.lastAccessedAt) {
    label = `Applicant opened the link ${new Date(token.lastAccessedAt).toLocaleString('en-ZA')}`;
    tone = 'success';
  } else {
    label = 'Invitation sent — awaiting applicant';
    tone = 'muted';
  }

  const toneClass = {
    muted: 'text-light-textMuted dark:text-dark-textMuted',
    success: 'text-light-statusPaid dark:text-dark-statusPaid',
    warning: 'text-light-statusNeedsReview dark:text-dark-statusNeedsReview',
    danger: 'text-light-danger dark:text-dark-danger',
  }[tone];

  return (
    <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
      <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Applicant invitation
      </h2>
      {error ? <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">{error}</p> : null}
      {notice ? (
        <p className="mt-1 text-xs text-light-statusPaid dark:text-dark-statusPaid">{notice}</p>
      ) : null}
      <p className={`mt-2 text-xs ${toneClass}`}>{label}</p>
      {token?.destinationHint ? (
        <p className="mt-0.5 text-xs text-light-textMuted dark:text-dark-textMuted">
          Sent to {token.destinationHint}
        </p>
      ) : null}
      {canAct ? (
        hasEmail ? (
          <Button className="mt-3" size="sm" disabled={busy} onClick={() => invite(Boolean(token))}>
            {busy ? 'Sending…' : token ? 'Resend invitation' : 'Invite applicant'}
          </Button>
        ) : (
          <p className="mt-2 text-xs text-light-textMuted dark:text-dark-textMuted">
            Add an applicant email address before inviting.
          </p>
        )
      ) : null}
    </div>
  );
}

interface DocumentRequirementRow {
  id: string;
  requirementKey: string;
  label: string;
  isRequired: boolean;
  status: 'requested' | 'uploaded' | 'reviewed' | 'accepted' | 'rejected';
  rejectionReason: string | null;
  documentId: string | null;
  uploadedAt: string | null;
  originalFileName: string | null;
  reviewedAt: string | null;
  ocr: { overallConfidence: number; fieldCount: number; reviewedAt: string | null } | null;
}

const REQUIREMENT_STATUS_LABEL: Record<DocumentRequirementRow['status'], string> = {
  requested: 'Missing — requested',
  uploaded: 'Uploaded — awaiting review',
  reviewed: 'Reviewed',
  accepted: 'Accepted',
  rejected: 'Needs correction',
};

// Launch-hardening pass (WORKLOG.md 2026-08-26), Section 3: previously this panel could only
// *request* documents -- it never showed staff what the applicant actually uploaded, when, or
// whether OCR had extracted anything from it, and had no way to accept/reject a document. Now
// combines the full per-requirement review surface with the existing "Request documents" action.
function DocumentRequirementsPanel({ applicationId }: { applicationId: string }) {
  const [requirements, setRequirements] = useState<DocumentRequirementRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadRequirements() {
    try {
      const res = await fetch(`/api/v1/applications/${applicationId}/document-requirements`);
      const body = await res.json();
      setRequirements(body.requirements ?? []);
    } catch {
      setRequirements([]);
    }
  }

  useEffect(() => {
    void loadRequirements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  async function viewDocument(documentId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/v1/documents/${documentId}`);
      const body = await res.json();
      if (!res.ok || !body.signedUrl) {
        setError(body.error?.message ?? 'Could not open this document.');
        return;
      }
      window.open(body.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setError('Could not open this document — check your connection and try again.');
    }
  }

  async function review(requirementId: string, status: 'accepted' | 'rejected', rejectionReason?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/applications/${applicationId}/document-requirements/${requirementId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, rejectionReason: rejectionReason ?? null }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error?.message ?? 'Could not update this document.');
        return;
      }
      setNotice(status === 'accepted' ? 'Document accepted.' : 'Marked as needing correction.');
      await loadRequirements();
    } catch {
      setError('Failed — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (requirements.length === 0) return null;

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/applications/${applicationId}/request-documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirementKeys: [...selected], message: message || null }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Could not request documents.');
        return;
      }
      setNotice(
        body.requested.length > 0
          ? `Requested: ${body.requested.join(', ')}.`
          : 'No change — the selected item(s) were already awaiting upload.',
      );
      setSelected(new Set());
      setMessage('');
      await loadRequirements();
    } catch {
      setError('Failed — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
      <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Applicant documents
      </h2>
      {error ? <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">{error}</p> : null}
      {notice ? (
        <p className="mt-1 text-xs text-light-statusPaid dark:text-dark-statusPaid">{notice}</p>
      ) : null}
      <ul className="mt-2 space-y-3">
        {requirements.map((r) => (
          <li key={r.id} className="rounded-md border border-light-border p-3 dark:border-dark-border">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
                <input type="checkbox" checked={selected.has(r.requirementKey)} onChange={() => toggle(r.requirementKey)} />
                <span className="font-medium text-light-textPrimary dark:text-dark-textPrimary">
                  {r.label}
                  {r.isRequired ? '' : ' (optional)'}
                </span>
              </label>
              <span className="text-xs text-light-textMuted dark:text-dark-textMuted">
                {REQUIREMENT_STATUS_LABEL[r.status]}
              </span>
            </div>

            {r.rejectionReason ? (
              <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">{r.rejectionReason}</p>
            ) : null}

            {r.documentId ? (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-light-textMuted dark:text-dark-textMuted">
                {r.uploadedAt ? (
                  <span>Uploaded {new Date(r.uploadedAt).toLocaleString('en-ZA')}</span>
                ) : null}
                <button
                  type="button"
                  className="text-light-accent underline dark:text-dark-accent"
                  onClick={() => viewDocument(r.documentId!)}
                >
                  View {r.originalFileName ?? 'document'}
                </button>
                {r.ocr ? (
                  <span>
                    OCR: {r.ocr.fieldCount} field{r.ocr.fieldCount === 1 ? '' : 's'} extracted, {Math.round(r.ocr.overallConfidence * 100)}% confidence
                  </span>
                ) : null}
              </div>
            ) : null}

            {r.documentId && (r.status === 'uploaded' || r.status === 'reviewed') ? (
              <div className="mt-2 flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => review(r.id, 'accepted')}>
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt('Why does this document need correction?');
                    if (reason === null) return;
                    void review(r.id, 'rejected', reason);
                  }}
                >
                  Needs correction
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <label className="mt-3 block text-xs">
        <span className="text-light-textMuted dark:text-dark-textMuted">Message to applicant (optional, for requested documents above)</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} className={inputClass} />
      </label>
      <Button className="mt-2" size="sm" disabled={busy || selected.size === 0} onClick={submit}>
        {busy ? 'Sending…' : 'Request selected documents'}
      </Button>
    </div>
  );
}
