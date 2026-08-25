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

interface DocumentRequirementRow {
  id: string;
  requirementKey: string;
  label: string;
  isRequired: boolean;
  status: 'requested' | 'uploaded' | 'reviewed' | 'accepted' | 'rejected';
  rejectionReason: string | null;
}

// Phase 12 (first-tenant-workflow predeploy pass, WORKLOG.md 2026-08-25): staff-facing "Request
// documents" action -- selects which requirement(s) to (re)request, with an optional message, and
// notifies the applicant. Idempotent by state (POST /request-documents route.ts) -- selecting an
// already-'requested' item and submitting again is a harmless no-op, not a duplicate notification.
function DocumentRequirementsPanel({ applicationId }: { applicationId: string }) {
  const [requirements, setRequirements] = useState<DocumentRequirementRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/applications/${applicationId}/document-requirements`)
      .then((res) => res.json())
      .then((body) => setRequirements(body.requirements ?? []))
      .catch(() => setRequirements([]));
  }, [applicationId]);

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
    } catch {
      setError('Failed — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-light-border p-4 dark:border-dark-border">
      <h2 className="text-sm font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        Request documents
      </h2>
      {error ? <p className="mt-1 text-xs text-light-danger dark:text-dark-danger">{error}</p> : null}
      {notice ? (
        <p className="mt-1 text-xs text-light-statusPaid dark:text-dark-statusPaid">{notice}</p>
      ) : null}
      <ul className="mt-2 space-y-1">
        {requirements.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-xs text-light-textSecondary dark:text-dark-textSecondary">
            <input
              type="checkbox"
              checked={selected.has(r.requirementKey)}
              onChange={() => toggle(r.requirementKey)}
            />
            <span>
              {r.label} — <span className="text-light-textMuted dark:text-dark-textMuted">{r.status}</span>
            </span>
          </li>
        ))}
      </ul>
      <label className="mt-2 block text-xs">
        <span className="text-light-textMuted dark:text-dark-textMuted">Message to applicant (optional)</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} className={inputClass} />
      </label>
      <Button className="mt-2" size="sm" disabled={busy || selected.size === 0} onClick={submit}>
        {busy ? 'Sending…' : 'Request selected documents'}
      </Button>
    </div>
  );
}
